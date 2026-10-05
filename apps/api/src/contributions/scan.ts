import { env } from "cloudflare:workers";
import { pushedCommits } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { ContributionStore } from "./store.ts";
import { startChecks } from "../checks/start.ts";
import { runtimeAt, saveRuntime } from "../repos/detect.ts";
import { evaluateCommit } from "../conformance/evaluate.ts";
import type { Runtime } from "@appmarket/shared";

/** Repos the scan looks at per run (each costs one Artifacts log call). */
const BATCH = 50;

/**
 * #143, runs every minute (cron): copies recent events into contributions, then checks a batch of
 * repos (least recently checked first) and reads the commits of those that changed since their
 * last scan. Repos never scanned are read in full, which is the commit backfill.
 */
/** A repo as the scan reads it. */
interface ScanRow {
	id: string;
	git_repo: string;
	state: string;
	runtime: Runtime;
	created_at: string;
	contributions_head: string | null;
	contributions_scanned_at: string | null;
}

/** New repos get checks on their first push; older repos seen for the first time are only caught up. */
const NEW_REPO_MS = 7 * 86_400_000;

/**
 * Processes a repo whose default branch moved: its commits (contributions), its runtime while it is
 * a draft, checks (#27) and conformance (#68) on the new head. Returns false when nothing changed.
 */
export async function processRepo(repo: ScanRow, now = new Date().toISOString()): Promise<{ changed: boolean; commits: number }> {
	const store = new ContributionStore(env.DB);
	const { commits: log, defaultBranch } = await pushedCommits(repo.git_repo, 500);
	const head = log[0]?.hash ?? null;
	if (!head || head === repo.contributions_head) {
		await env.DB.prepare("UPDATE repos SET contributions_checked_at = ? WHERE id = ?").bind(now, repo.id).run();
		return { changed: false, commits: 0 };
	}
	const commits = await store.addCommits(repo.id, log);
	// Drafts follow their code; published versions get their runtime at submit.
	if (repo.state === "draft") {
		const runtime = await runtimeAt(repo.git_repo, head).catch(() => null);
		if (runtime) await saveRuntime(repo.id, runtime);
	}
	// #27: checks on the new head, except when an older repo is only being caught up.
	const caughtUp = !repo.contributions_head && !!repo.contributions_scanned_at && Date.now() - Date.parse(repo.created_at) > NEW_REPO_MS;
	if (!caughtUp) await startChecks({ id: repo.id, gitRepo: repo.git_repo, fullName: repo.id }, head, "push", `refs/heads/${defaultBranch}`).catch(() => null);
	// #68: conformance rules on every push (stored per commit).
	await evaluateCommit({ id: repo.id, gitRepo: repo.git_repo, runtime: repo.runtime }, head).catch((e) => logEvent("conformance.failed", { repo: repo.id, error: String(e) }, "warn"));
	await env.DB.prepare("UPDATE repos SET contributions_head = ?, contributions_scanned_at = ?, contributions_checked_at = ? WHERE id = ?").bind(head, now, now, repo.id).run();
	return { changed: true, commits };
}

/** A push through appmarket.org's Git remote: process the repo now instead of on the next scan. */
export async function processPush(repoId: string): Promise<void> {
	const repo = await env.DB.prepare("SELECT id, git_repo, state, runtime, created_at, contributions_head, contributions_scanned_at FROM repos WHERE id = ? AND git_repo IS NOT NULL").bind(repoId).first<ScanRow>();
	if (repo) await processRepo(repo);
}

/**
 * #143, runs every minute (cron): copies recent events into contributions, then checks a batch of
 * repos (least recently checked first) and processes those whose default branch moved.
 */
export async function scanContributions(): Promise<{ checked: number; scanned: number; commits: number }> {
	const store = new ContributionStore(env.DB);
	await store.syncEvents(new Date(Date.now() - 86_400_000).toISOString());
	const { results: repos } = await env.DB.prepare(
		`SELECT id, git_repo, state, runtime, created_at, contributions_head, contributions_scanned_at FROM repos WHERE git_repo IS NOT NULL AND state != 'removed'
		 ORDER BY contributions_checked_at IS NOT NULL, contributions_checked_at LIMIT ?`,
	)
		.bind(BATCH)
		.all<ScanRow>();
	let scanned = 0;
	let commits = 0;
	const now = new Date().toISOString();
	for (const repo of repos) {
		try {
			const r = await processRepo(repo, now);
			if (r.changed) {
				scanned++;
				commits += r.commits;
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
