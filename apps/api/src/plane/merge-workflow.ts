import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import type { Runtime } from "@appmarket/shared";
import { blockingFailures } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { mintGitToken, revokeGitToken } from "../artifacts/git.ts";
import { startChecks } from "../checks/start.ts";
import { CheckStore } from "../checks/store.ts";
import { evaluateCommit } from "../conformance/evaluate.ts";
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
				await tellBoard(repo.id, merge.task_id, { id: mergeId, ...board });
			});
		const fail = (name: string, error: string, details?: unknown) =>
			set(name, { status: "failed", error, details: details ? JSON.stringify(details) : null }, { status: "failed", sha: null, error });
		try {
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
				const error = `The branch conflicts with ${merge.base_branch}${rebased.conflicts.length ? ` in ${rebased.conflicts.slice(0, 5).join(", ")}` : ""}. Rebase it onto ${merge.base_branch}, push it to the session fork, then merge again.`;
				await set("status: conflict", { status: "conflict", error, details: JSON.stringify({ conflicts: rebased.conflicts }) }, { status: "conflict", sha: null, error, conflicts: rebased.conflicts });
				return;
			}
			if (rebased.status === "no_branch") return void (await fail("failed: no branch", `${merge.branch} is not in the session's fork. Push it to the appmarket-session remote first.`));
			if (rebased.status === "nothing") return void (await fail("failed: nothing", `${merge.branch} has no commits beyond ${merge.base_branch}.`));
			if (rebased.status !== "rebased" || !rebased.head || !rebased.base) return void (await fail("failed: rebase", "The rebase did not finish."));
			const head = rebased.head;
			const base = rebased.base;

			await step.do("copy checkpoints", () => copyCheckpoints(repo.id, rebased.map));
			await set("status: checking", { status: "checking", base_sha: base, head_sha: head }, { status: "checking", sha: head, error: null });

			const runId = await step.do("start checks", () => startChecks(fork, head, "push", `refs/heads/appmarket/merge/${mergeId}`));
			if (!runId) return void (await fail("failed: checks", "The checks could not start."));
			await step.do("record checks run", () => updateMerge(mergeId, { checks_run_id: runId }));
			let checks = await step.do("checks 0", () => checkRun(fork.id, head));
			for (let i = 1; i <= CHECK_POLLS && !isDone(checks?.status); i++) {
				await step.sleep(`wait ${i}`, "20 seconds");
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
			const pushed = parseMarkers(
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
									env: { MAIN_REMOTE: main!.remote, MAIN_TOKEN: main!.token, FORK_REMOTE: forked!.remote, FORK_TOKEN: forked!.token, BASE: merge.base_branch!, MERGE_ID: mergeId, HEAD_SHA: head, BASE_SHA: base },
									config: { timeout: 15 * 60_000, retries: { limit: 1, delay: 10_000 } },
								})
							).logs,
						),
				),
			);
			if (pushed.status === "base_moved") return void (await fail("failed: base moved", `${merge.base_branch} changed while the checks ran. Merge again.`));
			if (pushed.status !== "merged") return void (await fail("failed: push", "The checked commit could not be pushed."));
			await set("status: merged", { status: "merged" }, { status: "merged", sha: head, error: null });
			await step.do("log", async () => logEvent("plane.merged", { merge: mergeId, commit: head.slice(0, 12), notes: pushed.notes }));
		} catch (error) {
			await fail("failed: error", `The merge stopped: ${error instanceof Error ? error.message.split("\n").slice(-3).join(" ") : String(error)}`.slice(0, 500));
			logEvent("plane.merge_failed", { merge: mergeId }, "error");
			throw error;
		}
	}
}

const isDone = (s: string | undefined) => s === "passed" || s === "failed" || s === "error";

async function checkRun(forkId: string, commit: string): Promise<{ status: string; failed: string[] } | null> {
	const run = await new CheckStore(env.DB).latestFor(forkId, commit);
	return run ? { status: run.status, failed: (run.results ?? []).filter((r) => r.status === "failed").map((r) => r.name) } : null;
}

async function loadContext(mergeId: string): Promise<MergeContext> {
	const merge = await loadMerge(mergeId);
	if (!merge) throw new Error(`No merge ${mergeId}`);
	const row = await env.DB.prepare(
		`SELECT r.git_repo AS repo_git, r.runtime, f.id AS fork_id, f.git_repo AS fork_git, fo.handle || '/' || f.slug AS fork_name
		 FROM agent_sessions s JOIN repos r ON r.id = s.repo_id JOIN repos f ON f.id = s.fork_repo_id JOIN owners fo ON fo.id = f.owner_id WHERE s.id = ?`,
	)
		.bind(merge.session_id)
		.first<{ repo_git: string; runtime: Runtime; fork_id: string; fork_git: string | null; fork_name: string }>();
	if (!row?.fork_git) throw new Error("The session's fork is gone.");
	return { merge, repo: { id: merge.repo_id, gitRepo: row.repo_git, runtime: row.runtime }, fork: { id: row.fork_id, gitRepo: row.fork_git, fullName: row.fork_name } };
}

export async function tellBoard(repoId: string, taskId: string, merge: TaskMerge): Promise<void> {
	const stub = env.PLANE.get(env.PLANE.idFromName(repoId)) as unknown as DurableObjectStub<RepoPlane>;
	await stub.setMerge(taskId, merge).catch(() => undefined);
}
