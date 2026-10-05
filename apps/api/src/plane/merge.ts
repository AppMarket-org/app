import type { Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { listBranches } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import type { TaskMerge } from "./merge-store.ts";
import { type MergeParams, reportMerge } from "./merge-workflow.ts";

/** What a merge is for, and where the branch lives. */
export interface MergeRequest {
	repo: Pick<Repo, "id" | "gitRepo" | "fullName">;
	sourceRepoId: string;
	branch: string;
	/** Board task (#236) and its agent session, or a pull request (#256). */
	taskId?: string;
	sessionId?: string;
	pullId?: string;
	/** The target branch; the repo's default branch (or the branch with its code) when not given. */
	baseBranch?: string;
}

/**
 * #238/#256: starts merging a branch into the repo (or returns the merge already running for the
 * same task or pull request).
 */
export async function startMerge(request: MergeRequest): Promise<TaskMerge> {
	const { repo, branch } = request;
	const owner = request.pullId ? ["pull_id", request.pullId] : ["task_id", request.taskId ?? ""];
	const running = await env.DB.prepare(`SELECT id, status, head_sha FROM merges WHERE ${owner[0]} = ? AND status IN ('queued', 'rebasing', 'checking', 'merging') ORDER BY created_at DESC LIMIT 1`)
		.bind(owner[1])
		.first<{ id: string; status: TaskMerge["status"]; head_sha: string | null }>();
	if (running) return { id: running.id, status: running.status, sha: running.head_sha, error: null };
	const id = crypto.randomUUID();
	const { defaultBranch, branches } = await listBranches(repo.gitRepo!);
	const base = request.baseBranch ? branches.find((b) => b.name === request.baseBranch) : pickBranch(defaultBranch, branches);
	const row = { repo_id: repo.id, task_id: request.taskId ?? null, pull_id: request.pullId ?? null };
	await env.DB.prepare("INSERT INTO merges (id, repo_id, source_repo_id, task_id, session_id, pull_id, branch, base_branch, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(id, repo.id, request.sourceRepoId, row.task_id, request.sessionId ?? null, row.pull_id, branch, base?.name ?? null, base ? "queued" : "failed")
		.run();
	if (!base) {
		const merge: TaskMerge = { id, status: "failed", sha: null, error: request.baseBranch ? `${request.baseBranch} does not exist.` : "The repo has no branch to merge into yet." };
		await env.DB.prepare("UPDATE merges SET error = ? WHERE id = ?").bind(merge.error, id).run();
		await reportMerge(row, merge);
		return merge;
	}
	const params = {
		provider: "cloudflare-artifacts",
		providerData: { namespace: env.ARTIFACTS_NAMESPACE },
		event: { type: "push" },
		owner: env.ARTIFACTS_NAMESPACE,
		repo: repo.gitRepo!,
		sha: base.sha,
		trigger: "push",
		ref: `refs/heads/${base.name}`,
		mergeId: id,
	} as MergeParams;
	await env.MERGE_WORKFLOW.create({ id, params });
	logEvent("merge.started", { repo: repo.fullName, merge: id, branch, base: base.name, pull: request.pullId ?? null, task: request.taskId ?? null });
	const merge: TaskMerge = { id, status: "queued", sha: null, error: null };
	await reportMerge(row, merge);
	return merge;
}

/** The fork of an agent session (where its branches are pushed). */
export async function sessionFork(sessionId: string): Promise<string | null> {
	const row = await env.DB.prepare("SELECT fork_repo_id FROM agent_sessions WHERE id = ?").bind(sessionId).first<{ fork_repo_id: string }>();
	return row?.fork_repo_id ?? null;
}
