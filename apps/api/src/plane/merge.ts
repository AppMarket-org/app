import type { Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { listBranches } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import type { TaskMerge } from "./merge-store.ts";
import { type MergeParams, tellBoard } from "./merge-workflow.ts";

/**
 * #238: starts merging a finished task's branch (or returns the merge already running for it). The
 * base is the repo's default branch, or the branch that has its code (see pickBranch).
 */
export async function startMerge(repo: Pick<Repo, "id" | "gitRepo" | "fullName">, taskId: string, sessionId: string, branch: string): Promise<TaskMerge> {
	const running = await env.DB.prepare("SELECT id, status, head_sha FROM plane_merges WHERE task_id = ? AND status IN ('queued', 'rebasing', 'checking', 'merging') ORDER BY created_at DESC LIMIT 1")
		.bind(taskId)
		.first<{ id: string; status: TaskMerge["status"]; head_sha: string | null }>();
	if (running) return { id: running.id, status: running.status, sha: running.head_sha, error: null };
	const id = crypto.randomUUID();
	const { defaultBranch, branches } = await listBranches(repo.gitRepo!);
	const base = pickBranch(defaultBranch, branches);
	await env.DB.prepare("INSERT INTO plane_merges (id, repo_id, task_id, session_id, branch, base_branch, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, repo.id, taskId, sessionId, branch, base?.name ?? null, base ? "queued" : "failed")
		.run();
	if (!base) {
		const merge: TaskMerge = { id, status: "failed", sha: null, error: "The repo has no branch to merge into yet." };
		await env.DB.prepare("UPDATE plane_merges SET error = ? WHERE id = ?").bind(merge.error, id).run();
		await tellBoard(repo.id, taskId, merge);
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
	logEvent("plane.merge_started", { repo: repo.fullName, merge: id, branch, base: base.name });
	const merge: TaskMerge = { id, status: "queued", sha: null, error: null };
	await tellBoard(repo.id, taskId, merge);
	return merge;
}
