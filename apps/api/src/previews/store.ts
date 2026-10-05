import type { BranchPreview, DeploymentStatus } from "@appmarket/shared";
import { env } from "cloudflare:workers";

export interface PreviewSettingsRow {
	repo_id: string;
	user_id: string;
	account_id: string;
	enabled: number;
	deploy_default: number;
	worker_name: string | null;
	checked_at: string | null;
}

/** #28: per-repo preview settings and the newest preview deploy of each branch. */
export const previewStore = {
	settings: (repoId: string) => env.DB.prepare("SELECT * FROM repo_preview_settings WHERE repo_id = ?").bind(repoId).first<PreviewSettingsRow>(),

	save: (repoId: string, userId: string, accountId: string, s: { enabled: boolean; deployDefault: boolean; workerName: string | null }) =>
		env.DB.prepare(
			`INSERT INTO repo_preview_settings (repo_id, user_id, account_id, enabled, deploy_default, worker_name) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (repo_id) DO UPDATE SET user_id = excluded.user_id, account_id = excluded.account_id, enabled = excluded.enabled,
			   deploy_default = excluded.deploy_default, worker_name = excluded.worker_name, checked_at = NULL`,
		)
			.bind(repoId, userId, accountId, s.enabled ? 1 : 0, s.deployDefault ? 1 : 0, s.workerName)
			.run(),

	disable: (repoId: string) => env.DB.prepare("UPDATE repo_preview_settings SET enabled = 0, deploy_default = 0 WHERE repo_id = ?").bind(repoId).run(),

	checked: (repoId: string) => env.DB.prepare("UPDATE repo_preview_settings SET checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE repo_id = ?").bind(repoId).run(),

	/** Enabled repos that still exist, least recently compared first. */
	enabled: async (limit: number) =>
		(
			await env.DB.prepare(
				`SELECT s.*, r.git_repo, r.slug FROM repo_preview_settings s JOIN repos r ON r.id = s.repo_id
				 WHERE (s.enabled = 1 OR s.deploy_default = 1) AND r.state != 'removed' AND r.git_repo IS NOT NULL ORDER BY s.checked_at IS NOT NULL, s.checked_at LIMIT ?`,
			)
				.bind(limit)
				.all<PreviewSettingsRow & { git_repo: string; slug: string }>()
		).results,

	/** The newest preview deploy of each branch. */
	latest: async (repoId: string): Promise<BranchPreview[]> => {
		const { results } = await env.DB.prepare(
			`SELECT d.id, d.preview_branch, d.commit_sha, d.status, d.url, d.error, d.updated_at, d.deleted_at, d.worker_name, d.deploy_config FROM deployments d
			 WHERE d.repo_id = ? AND d.preview_branch IS NOT NULL
			   AND d.created_at = (SELECT MAX(created_at) FROM deployments x WHERE x.repo_id = d.repo_id AND x.preview_branch = d.preview_branch)
			 ORDER BY d.updated_at DESC`,
		)
			.bind(repoId)
			.all<{ id: string; preview_branch: string; commit_sha: string; status: DeploymentStatus; url: string | null; error: string | null; updated_at: string; deleted_at: string | null; worker_name: string; deploy_config: string }>();
		return results.map((r) => ({
			branch: r.preview_branch,
			commit: r.commit_sha,
			deploymentId: r.id,
			status: r.status,
			url: r.deleted_at ? null : r.url,
			error: r.error,
			updatedAt: r.deleted_at ?? r.updated_at,
			deleted: !!r.deleted_at,
			workerName: r.worker_name,
			resources: previewResources(r.deploy_config),
		}));
	},
};

/** #192: names of the D1 databases, KV namespaces and R2 buckets a deploy config creates. */
export function previewResources(deployConfig: string): string[] {
	try {
		const c = (JSON.parse(deployConfig) as { config?: Record<string, unknown> }).config ?? {};
		const list = (k: string) => (Array.isArray(c[k]) ? (c[k] as Record<string, unknown>[]) : []);
		return [
			...list("d1_databases").map((d) => `D1 database ${String(d.database_name ?? d.binding)}`),
			...list("kv_namespaces").map((k) => `KV namespace for ${String(k.binding)}`),
			...list("r2_buckets").map((b) => `R2 bucket ${String(b.bucket_name ?? b.binding)}`),
		];
	} catch {
		return [];
	}
}

export const markPreviewDeleted = (deploymentId: string) =>
	env.DB.prepare("UPDATE deployments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(deploymentId).run();
