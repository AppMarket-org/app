import type { BranchPreview, DeploymentStatus } from "@appmarket/shared";
import { env } from "cloudflare:workers";

export interface PreviewSettingsRow {
	repo_id: string;
	user_id: string;
	account_id: string;
	enabled: number;
	checked_at: string | null;
}

/** #28: per-repo preview settings and the newest preview deploy of each branch. */
export const previewStore = {
	settings: (repoId: string) => env.DB.prepare("SELECT * FROM repo_preview_settings WHERE repo_id = ?").bind(repoId).first<PreviewSettingsRow>(),

	save: (repoId: string, userId: string, accountId: string, enabled: boolean) =>
		env.DB.prepare(
			`INSERT INTO repo_preview_settings (repo_id, user_id, account_id, enabled) VALUES (?, ?, ?, ?)
			 ON CONFLICT (repo_id) DO UPDATE SET user_id = excluded.user_id, account_id = excluded.account_id, enabled = excluded.enabled, checked_at = NULL`,
		)
			.bind(repoId, userId, accountId, enabled ? 1 : 0)
			.run(),

	disable: (repoId: string) => env.DB.prepare("UPDATE repo_preview_settings SET enabled = 0 WHERE repo_id = ?").bind(repoId).run(),

	checked: (repoId: string) => env.DB.prepare("UPDATE repo_preview_settings SET checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE repo_id = ?").bind(repoId).run(),

	/** Enabled repos that still exist, least recently compared first. */
	enabled: async (limit: number) =>
		(
			await env.DB.prepare(
				`SELECT s.*, r.git_repo, r.slug FROM repo_preview_settings s JOIN repos r ON r.id = s.repo_id
				 WHERE s.enabled = 1 AND r.state != 'removed' AND r.git_repo IS NOT NULL ORDER BY s.checked_at IS NOT NULL, s.checked_at LIMIT ?`,
			)
				.bind(limit)
				.all<PreviewSettingsRow & { git_repo: string; slug: string }>()
		).results,

	/** The newest preview deploy of each branch. */
	latest: async (repoId: string): Promise<BranchPreview[]> => {
		const { results } = await env.DB.prepare(
			`SELECT d.id, d.preview_branch, d.commit_sha, d.status, d.url, d.error, d.updated_at FROM deployments d
			 WHERE d.repo_id = ? AND d.preview_branch IS NOT NULL
			   AND d.created_at = (SELECT MAX(created_at) FROM deployments x WHERE x.repo_id = d.repo_id AND x.preview_branch = d.preview_branch)
			 ORDER BY d.updated_at DESC`,
		)
			.bind(repoId)
			.all<{ id: string; preview_branch: string; commit_sha: string; status: DeploymentStatus; url: string | null; error: string | null; updated_at: string }>();
		return results.map((r) => ({ branch: r.preview_branch, commit: r.commit_sha, deploymentId: r.id, status: r.status, url: r.url, error: r.error, updatedAt: r.updated_at }));
	},
};
