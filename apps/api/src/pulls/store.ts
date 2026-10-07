import { redactSecrets } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { nextNumber } from "../repos/numbers.ts";

/** Saves a pull request with the repo's next number (shared with issues, #294). */
export async function insertPull(p: {
	repoId: string;
	title: string;
	body: string;
	authorId: string;
	sourceRepoId: string;
	sourceBranch: string;
	targetBranch: string;
	headSha: string;
	taskId?: string;
	/** The agent session whose work it is (a task's pull request). */
	agentSessionId?: string;
}): Promise<{ id: string; number: number }> {
	const id = crypto.randomUUID();
	const number = await nextNumber(env.DB, p.repoId);
	await env.DB.prepare(
		`INSERT INTO pull_requests (id, repo_id, number, title, body, author_id, source_repo_id, source_branch, target_branch, head_sha, task_id, agent_session_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, p.repoId, number, redactSecrets(p.title).text, redactSecrets(p.body).text, p.authorId, p.sourceRepoId, p.sourceBranch, p.targetBranch, p.headSha, p.taskId ?? null, p.agentSessionId ?? null)
		.run();
	return { id, number };
}

export interface PullSettings {
	requireApproval: boolean;
	reviewAgentWork: boolean;
	/** #73: a fork gets a pull request each time its template publishes a version. */
	upstreamSync: boolean;
	/** #308: branches agent sessions may not push to, beyond the default branch (names, or "prefix/*"). */
	protectedBranches: string[];
}

export async function pullSettings(repoId: string): Promise<PullSettings> {
	const row = await env.DB.prepare("SELECT require_approval, review_agent_work, upstream_sync, protected_branches FROM repo_pull_settings WHERE repo_id = ?")
		.bind(repoId)
		.first<{ require_approval: number; review_agent_work: number; upstream_sync: number; protected_branches: string }>();
	const protectedBranches = (() => {
		try {
			const v = JSON.parse(row?.protected_branches ?? "[]") as unknown;
			return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
		} catch {
			return [];
		}
	})();
	return { requireApproval: row?.require_approval === 1, reviewAgentWork: row?.review_agent_work === 1, upstreamSync: row?.upstream_sync === 1, protectedBranches };
}

export async function savePullSettings(repoId: string, s: PullSettings): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO repo_pull_settings (repo_id, require_approval, review_agent_work, upstream_sync, protected_branches) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (repo_id) DO UPDATE SET require_approval = excluded.require_approval, review_agent_work = excluded.review_agent_work, upstream_sync = excluded.upstream_sync, protected_branches = excluded.protected_branches`,
	)
		.bind(repoId, s.requireApproval ? 1 : 0, s.reviewAgentWork ? 1 : 0, s.upstreamSync ? 1 : 0, JSON.stringify(s.protectedBranches))
		.run();
}
