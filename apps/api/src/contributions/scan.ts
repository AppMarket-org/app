import { env } from "cloudflare:workers";
import { pushedCommits } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { ContributionStore } from "./store.ts";
import { startChecks } from "../checks/start.ts";

/** Repos the scan looks at per run (each costs one Artifacts info() call, plus a log when changed). */
const BATCH = 50;

/**
 * #143, runs every minute (cron): copies recent events into contributions, then checks a batch of
 * repos (least recently checked first) and reads the commits of those that changed since their
 * last scan. Repos never scanned are read in full, which is the commit backfill.
 */
export async function scanContributions(): Promise<{ checked: number; scanned: number; commits: number }> {
	const store = new ContributionStore(env.DB);
	await store.syncEvents(new Date(Date.now() - 86_400_000).toISOString());
	const { results: repos } = await env.DB.prepare(
		`SELECT id, git_repo, contributions_scanned_at FROM repos WHERE git_repo IS NOT NULL AND state != 'removed'
		 ORDER BY contributions_checked_at IS NOT NULL, contributions_checked_at LIMIT ?`,
	)
		.bind(BATCH)
		.all<{ id: string; git_repo: string; contributions_scanned_at: string | null }>();
	let scanned = 0;
	let commits = 0;
	const now = new Date().toISOString();
	for (const repo of repos) {
		try {
			const { lastPushAt, commits: log, defaultBranch } = await pushedCommits(repo.git_repo, 500);
			if (lastPushAt && (!repo.contributions_scanned_at || lastPushAt > repo.contributions_scanned_at)) {
				commits += await store.addCommits(repo.id, log);
				// #27: checks on the newest commit of a repo that was pushed to (not on the first backfill scan).
				if (repo.contributions_scanned_at && log[0]) await startChecks({ id: repo.id, gitRepo: repo.git_repo, fullName: repo.id }, log[0].hash, "push", `refs/heads/${defaultBranch}`).catch(() => null);
				scanned++;
				await env.DB.prepare("UPDATE repos SET contributions_scanned_at = ?, contributions_checked_at = ? WHERE id = ?").bind(lastPushAt, now, repo.id).run();
			} else {
				await env.DB.prepare("UPDATE repos SET contributions_checked_at = ? WHERE id = ?").bind(now, repo.id).run();
			}
		} catch (error) {
			// One unreachable repo must not stop the others; it is retried on its next turn.
			await env.DB.prepare("UPDATE repos SET contributions_checked_at = ? WHERE id = ?").bind(now, repo.id).run();
			logEvent("contributions.scan_failed", { repo: repo.id, error: error instanceof Error ? error.message : String(error) }, "warn");
		}
	}
	if (scanned) logEvent("contributions.scanned", { checked: repos.length, scanned, commits });
	return { checked: repos.length, scanned, commits };
}
