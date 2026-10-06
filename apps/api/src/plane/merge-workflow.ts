import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import type { Runtime } from "@appmarket/shared";
import { blockingFailures } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { listBranches, mintGitToken, revokeGitToken, updateRef } from "../artifacts/git.ts";
import { startChecks } from "../checks/start.ts";
import { processPush } from "../contributions/scan.ts";
import { CheckStore } from "../checks/store.ts";
import { evaluateCommit } from "../conformance/evaluate.ts";
import { closeIssues, issueParticipants } from "../issues/board.ts";
import { notifyIssue } from "../pulls/notify.ts";
import { closingNumbers } from "../issues/closing.ts";
import { logEvent } from "../observability/log.ts";
import type { RepoPlane } from "./coordinator.ts";
import { parseMarkers, pushScript, rebaseScript } from "./merge-commands.ts";
import { copyCheckpoints, loadMerge, type MergeRow, type TaskMerge, updateMerge } from "./merge-store.ts";

export type MergeParams = CiParams<CloudflareArtifacts> & { mergeId: string };

interface MergeContext {
	merge: MergeRow;
	repo: { id: string; gitRepo: string; runtime: Runtime };
	fork: { id: string; gitRepo: string; fullName: string };
}

const CHECK_POLLS = 60;
const TOKEN_TTL = 1800;

/**
 * Fresh short-lived tokens for one runner, revoked right after it. Workflows replay their code on
 * every resume, so nothing minted here is kept in a step's (persisted) output: a replay mints new
 * tokens, finds the runner's cached result, and revokes them again.
 */
async function withTokens<T>(specs: [string, "read" | "write"][], fn: (tokens: { remote: string; token: string }[]) => Promise<T>): Promise<T> {
	const minted = await Promise.all(specs.map(([repo, scope]) => mintGitToken(repo, scope, TOKEN_TTL)));
	try {
		return await fn(minted);
	} finally {
		await Promise.all(minted.map((t, i) => revokeGitToken(specs[i]![0], t.id).catch(() => false)));
	}
}

const stdout = (logs: { stdout: unknown }) => (typeof logs.stdout === "string" ? logs.stdout : "");

/**
 * #238: merges a finished task's branch. The rebase and the final push run in fresh containers that
 * never run the repo's code; the checks run on the rebased commit in the session fork (#27), with
 * conformance (#68) compared to the base; then the base branch fast-forwards to exactly the commit
 * that was checked. The board (#236) shows each stage; redeploys follow from the push (#37).
 */
export class MergeWorkflow extends CIWorkflow<CloudflareArtifacts, Env & CiBindings> {
	protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
		const { mergeId } = event.payload as MergeParams;
		const ctx = await step.do("load", () => loadContext(mergeId));
		const { merge, repo, fork } = ctx;
		const set = (name: string, fields: Parameters<typeof updateMerge>[1], board: Omit<TaskMerge, "id">) =>
			step.do(name, async () => {
				await updateMerge(mergeId, fields);
				await reportMerge(merge, { id: mergeId, ...board });
			});
		const fail = (name: string, error: string, details?: unknown) =>
			set(name, { status: "failed", error, details: details ? JSON.stringify(details) : null }, { status: "failed", sha: null, error });
		try {
			// Fast path: the branch already contains the base, so the rebase would change nothing.
			const fast = await step.do("plan", () => upToDate(repo.gitRepo, fork.gitRepo, merge.base_branch!, merge.branch).catch(() => null));
			const { base, head } = fast ?? (await rebase());
			if (!head || !base) return;
			const checkedRef = fast ? `refs/heads/${merge.branch}` : `refs/heads/appmarket/merge/${mergeId}`;
			await set("status: checking", { status: "checking", base_sha: base, head_sha: head }, { status: "checking", sha: head, error: null });

			// Checks already run (or running) on this commit, e.g. since the pull request was opened, are reused.
			const runId = await step.do("start checks", () => startChecks(fork, head, "push", checkedRef));
			if (!runId) return void (await fail("failed: checks", "The checks could not start."));
			await step.do("record checks run", () => updateMerge(mergeId, { checks_run_id: runId }));
			let checks = await step.do("checks 0", () => checkRun(fork.id, head));
			for (let i = 1; i <= CHECK_POLLS && !isDone(checks?.status); i++) {
				await step.sleep(`wait ${i}`, i <= 6 ? "5 seconds" : "20 seconds");
				checks = await step.do(`checks ${i}`, () => checkRun(fork.id, head));
			}
			if (checks?.status !== "passed") {
				const failed = checks?.failed.length ? checks.failed.join(", ") : checks?.status === "error" ? "install" : "timed out";
				return void (await fail("failed: checks result", `Checks did not pass: ${failed}.`, { checks: checks?.failed ?? [] }));
			}

			// Conformance: only rules this change breaks block it; rules the base already fails do not.
			const introduced = await step.do("conformance", async () => {
				const [after, before] = await Promise.all([
					evaluateCommit({ id: repo.id, gitRepo: fork.gitRepo, runtime: repo.runtime }, head),
					evaluateCommit({ id: repo.id, gitRepo: repo.gitRepo, runtime: repo.runtime }, base),
				]);
				const already = new Set(blockingFailures(before).map((r) => r.id));
				return blockingFailures(after)
					.filter((r) => !already.has(r.id))
					.map((r) => r.id);
			});
			if (introduced.length) return void (await fail("failed: conformance", `The change breaks conformance rules: ${introduced.join(", ")}.`, { conformance: introduced }));

			await set("status: merging", { status: "merging" }, { status: "merging", sha: head, error: null });
			// Same repo: the commit is already there, so the Worker moves the branch itself (compare-and-swap).
			// "unknown" (no clear answer) falls back to the container, which checks the base again.
			const moved = fast && fork.id === repo.id ? await step.do("fast-forward", () => fastForward(repo.gitRepo, merge.base_branch!, base, head)) : "unknown";
			if (moved === "base_moved") return void (await fail("failed: base moved", `${merge.base_branch} changed while the checks ran. Merge again.`));
			const pushed =
				moved === "merged"
					? { status: "merged", notes: false }
					: parseMarkers(
							await withTokens(
								[
									[repo.gitRepo, "write"],
									[fork.gitRepo, "read"],
								],
								async ([main, forked]) =>
									stdout(
										(
											await ci.runner({
												name: "push",
												command: pushScript,
												env: { MAIN_REMOTE: main!.remote, MAIN_TOKEN: main!.token, FORK_REMOTE: forked!.remote, FORK_TOKEN: forked!.token, BASE: merge.base_branch!, FORK_REF: checkedRef, HEAD_SHA: head, BASE_SHA: base },
												config: { timeout: 15 * 60_000, retries: { limit: 1, delay: 10_000 } },
											})
										).logs,
									),
							),
						);
			if (pushed.status === "base_moved") return void (await fail("failed: base moved", `${merge.base_branch} changed while the checks ran. Merge again.`));
			if (pushed.status === "changed") return void (await fail("failed: branch moved", `${merge.branch} changed while the checks ran. Merge again.`));
			if (pushed.status !== "merged") return void (await fail("failed: push", "The checked commit could not be pushed."));
			await set("status: merged", { status: "merged" }, { status: "merged", sha: head, error: null });
			await step.do("log", async () => logEvent("plane.merged", { merge: mergeId, commit: head.slice(0, 12), notes: pushed.notes, fast: !!fast, worker: moved === "merged" }));
			// The new base is a push like any other: auto-deploy and contributions follow now, not at the next cron.
			await step.do("process push", () => processPush(repo.id).catch(() => undefined));
		} catch (error) {
			await fail("failed: error", `The merge stopped: ${error instanceof Error ? error.message.split("\n").slice(-3).join(" ") : String(error)}`.slice(0, 500));
			logEvent("plane.merge_failed", { merge: mergeId }, "error");
			throw error;
		}

		/** The full path: rebase onto the base in a container, pushed to the fork as appmarket/merge/<id>. */
		async function rebase(): Promise<{ base: string | null; head: string | null }> {
			await set("status: rebasing", { status: "rebasing" }, { status: "rebasing", sha: null, error: null });
			const rebased = parseMarkers(
				await withTokens(
					[
						[repo.gitRepo, "read"],
						[fork.gitRepo, "write"],
					],
					async ([main, forked]) =>
						stdout(
							(
								await ci.runner({
									name: "rebase",
									command: rebaseScript,
									env: { MAIN_REMOTE: main!.remote, MAIN_TOKEN: main!.token, FORK_REMOTE: forked!.remote, FORK_TOKEN: forked!.token, BASE: merge.base_branch!, BRANCH: merge.branch, MERGE_ID: mergeId },
									config: { timeout: 15 * 60_000, retries: { limit: 1, delay: 10_000 } },
								})
							).logs,
						),
				),
			);
			if (rebased.status === "conflict") {
				const error = `The branch conflicts with ${merge.base_branch}${rebased.conflicts.length ? ` in ${rebased.conflicts.slice(0, 5).join(", ")}` : ""}. Rebase it onto ${merge.base_branch}, push it${merge.session_id ? " to the session fork" : ""}, then merge again.`;
				await set("status: conflict", { status: "conflict", error, details: JSON.stringify({ conflicts: rebased.conflicts }) }, { status: "conflict", sha: null, error, conflicts: rebased.conflicts });
				return { base: null, head: null };
			}
			if (rebased.status === "no_branch") {
				await fail("failed: no branch", merge.session_id ? `${merge.branch} is not in the session's fork. Push it to the appmarket-session remote first.` : `${merge.branch} no longer exists.`);
				return { base: null, head: null };
			}
			if (rebased.status === "nothing") {
				await fail("failed: nothing", `${merge.branch} has no commits beyond ${merge.base_branch}.`);
				return { base: null, head: null };
			}
			if (rebased.status !== "rebased" || !rebased.head || !rebased.base) {
				await fail("failed: rebase", "The rebase did not finish.");
				return { base: null, head: null };
			}

			await step.do("copy checkpoints", () => copyCheckpoints(repo.id, rebased.map));
			return { base: rebased.base, head: rebased.head };
		}
	}
}

const isDone = (s: string | undefined) => s === "passed" || s === "failed" || s === "error";

/**
 * The fast path's test: the base branch's head is already in the branch's history (looked up in
 * the branch's last 500 commits), so a rebase would change nothing. Null means "take the full path".
 */
export async function upToDate(repoGit: string, forkGit: string, baseBranch: string, branch: string): Promise<{ base: string; head: string } | null> {
	const [into, from] = await Promise.all([listBranches(repoGit), forkGit === repoGit ? null : listBranches(forkGit)]);
	const base = into.branches.find((b) => b.name === baseBranch)?.sha;
	const head = (from ?? into).branches.find((b) => b.name === branch)?.sha;
	if (!base || !head || base === head) return null;
	using git = await env.ARTIFACTS.get(forkGit);
	const log = await git.log({ ref: head, limit: 500 }).catch(() => []);
	return log.some((c) => c.hash === base) ? { base, head } : null;
}

/**
 * Moves the base branch from `base` to `head` in the same repo. Safe to repeat (Workflows replay
 * steps): when the answer is not "ok", the branch is read back, and one already at `head` counts as merged.
 */
async function fastForward(gitRepo: string, branch: string, base: string, head: string): Promise<"merged" | "base_moved" | "unknown"> {
	const result = await updateRef(gitRepo, branch, base, head);
	if (result === "ok") return "merged";
	const now = (await listBranches(gitRepo).catch(() => null))?.branches.find((b) => b.name === branch)?.sha;
	if (now === head) return "merged";
	if (now && now !== base) return "base_moved";
	return result === "stale" ? "base_moved" : "unknown";
}

async function checkRun(forkId: string, commit: string): Promise<{ status: string; failed: string[] } | null> {
	const run = await new CheckStore(env.DB).latestFor(forkId, commit);
	return run ? { status: run.status, failed: (run.results ?? []).filter((r) => r.status === "failed").map((r) => r.name) } : null;
}

async function loadContext(mergeId: string): Promise<MergeContext> {
	const merge = await loadMerge(mergeId);
	if (!merge) throw new Error(`No merge ${mergeId}`);
	const row = await env.DB.prepare(
		`SELECT r.git_repo AS repo_git, r.runtime, f.id AS fork_id, f.git_repo AS fork_git, fo.handle || '/' || f.slug AS fork_name
		 FROM repos r, repos f JOIN owners fo ON fo.id = f.owner_id WHERE r.id = ? AND f.id = ?`,
	)
		.bind(merge.repo_id, merge.source_repo_id)
		.first<{ repo_git: string; runtime: Runtime; fork_id: string; fork_git: string | null; fork_name: string }>();
	if (!row?.fork_git) throw new Error("The source repo is gone.");
	return { merge, repo: { id: merge.repo_id, gitRepo: row.repo_git, runtime: row.runtime }, fork: { id: row.fork_id, gitRepo: row.fork_git, fullName: row.fork_name } };
}

/** Tells whoever asked for the merge: the board task (#236) and/or the pull request (#256). */
export async function reportMerge(merge: Pick<MergeRow, "repo_id" | "task_id" | "pull_id">, state: TaskMerge): Promise<void> {
	if (merge.task_id) await tellBoard(merge.repo_id, merge.task_id, state);
	if (merge.pull_id && state.status === "merged") {
		await env.DB.prepare(
			"UPDATE pull_requests SET state = 'merged', merged_sha = ?, head_sha = COALESCE(?, head_sha), closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND state = 'open'",
		)
			.bind(state.sha, state.sha, merge.pull_id)
			.run();
	}
	if (state.status === "merged") {
		// #296: merged work closes its issue (a task's), and those its pull request says it fixes.
		const pull = merge.pull_id ? await env.DB.prepare("SELECT title, body, task_id FROM pull_requests WHERE id = ?").bind(merge.pull_id).first<{ title: string; body: string; task_id: string | null }>() : null;
		const ids = [merge.task_id, pull?.task_id].filter((x): x is string => !!x);
		const numbers = pull ? closingNumbers(`${pull.title}\n${pull.body}`) : [];
		const closed = await closeIssues(merge.repo_id, { ids, numbers }).catch(() => []);
		if (closed.length) {
			logEvent("issue.closed_by_merge", { repo: merge.repo_id, closed: closed.length });
			const repo = await env.DB.prepare("SELECT o.handle || '/' || r.slug AS name FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.id = ?").bind(merge.repo_id).first<{ name: string }>();
			for (const issue of closed) {
				const userIds = await issueParticipants(issue.id).catch(() => []);
				await notifyIssue({ repo: repo?.name ?? "", number: issue.number, title: issue.title, actorId: "", actor: "appmarket.org", what: "closed this issue: the work for it was merged", userIds }).catch(() => undefined);
			}
		}
	}
}

export async function tellBoard(repoId: string, taskId: string, merge: TaskMerge): Promise<void> {
	const stub = env.PLANE.get(env.PLANE.idFromName(repoId)) as unknown as DurableObjectStub<RepoPlane>;
	await stub.setMerge(taskId, merge).catch(() => undefined);
}
