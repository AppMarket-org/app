import { env } from "cloudflare:workers";
import { languageBytes } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";

/** #170: computes and stores the language breakdown of a published commit (unless a newer one replaced it). */
export async function storeLanguages(repoId: string, gitRepo: string, commit: string): Promise<void> {
	const bytes = await languageBytes(gitRepo, commit);
	await env.DB.prepare("UPDATE repos SET published_languages = ? WHERE id = ? AND published_commit = ?").bind(JSON.stringify(bytes), repoId, commit).run();
}

/** #170 backfill (cron): a few published repos without a breakdown per run. */
export async function backfillLanguages(limit = 3): Promise<void> {
	const { results } = await env.DB.prepare(
		"SELECT id, git_repo, published_commit FROM repos WHERE state = 'published' AND published_languages IS NULL AND git_repo IS NOT NULL AND published_commit IS NOT NULL LIMIT ?",
	)
		.bind(limit)
		.all<{ id: string; git_repo: string; published_commit: string }>();
	for (const r of results) {
		try {
			await storeLanguages(r.id, r.git_repo, r.published_commit);
		} catch (error) {
			// Mark as empty so one broken repo is not retried every minute; the next publish recomputes.
			await env.DB.prepare("UPDATE repos SET published_languages = '{}' WHERE id = ?").bind(r.id).run();
			logEvent("languages.failed", { repo: r.id, error: error instanceof Error ? error.message : String(error) }, "warn");
		}
	}
}
