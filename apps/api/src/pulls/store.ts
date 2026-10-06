import { redactSecrets } from "@appmarket/shared";
import { env } from "cloudflare:workers";

/** Saves a pull request with the repo's next number (retrying when two are opened at once). */
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
}): Promise<{ id: string; number: number }> {
	const id = crypto.randomUUID();
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await env.DB.prepare(
				`INSERT INTO pull_requests (id, repo_id, number, title, body, author_id, source_repo_id, source_branch, target_branch, head_sha, task_id)
				 VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM pull_requests WHERE repo_id = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(id, p.repoId, p.repoId, redactSecrets(p.title).text, redactSecrets(p.body).text, p.authorId, p.sourceRepoId, p.sourceBranch, p.targetBranch, p.headSha, p.taskId ?? null)
				.run();
			break;
		} catch (error) {
			if (attempt === 2 || !String(error).includes("UNIQUE")) throw error;
		}
	}
	const row = await env.DB.prepare("SELECT number FROM pull_requests WHERE id = ?").bind(id).first<{ number: number }>();
	return { id, number: row!.number };
}

export interface PullSettings {
	requireApproval: boolean;
	reviewAgentWork: boolean;
}

export async function pullSettings(repoId: string): Promise<PullSettings> {
	const row = await env.DB.prepare("SELECT require_approval, review_agent_work FROM repo_pull_settings WHERE repo_id = ?").bind(repoId).first<{ require_approval: number; review_agent_work: number }>();
	return { requireApproval: row?.require_approval === 1, reviewAgentWork: row?.review_agent_work === 1 };
}

export async function savePullSettings(repoId: string, s: PullSettings): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO repo_pull_settings (repo_id, require_approval, review_agent_work) VALUES (?, ?, ?) ON CONFLICT (repo_id) DO UPDATE SET require_approval = excluded.require_approval, review_agent_work = excluded.review_agent_work",
	)
		.bind(repoId, s.requireApproval ? 1 : 0, s.reviewAgentWork ? 1 : 0)
		.run();
}
