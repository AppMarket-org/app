import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckpointRecord } from "@appmarket/shared";
import { ApiError, call } from "./api.ts";
import { ensureDirs, QUEUE_DIR } from "./config.ts";
import { loadCredentials } from "./credentials.ts";
import { log } from "./log.ts";
import { writeState } from "./state.ts";

/** C13: one file per pending upload; deleted only after a 2xx (or a settled conflict). */
interface QueueItem {
	api: string;
	repo: string;
	record: CheckpointRecord;
	attempts: number;
	firstAt: string;
	nextAt: string;
	/** Replace whatever the server has for this commit (a rewritten commit's record). */
	force?: boolean;
}

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const fileFor = (repo: string, commit: string) => join(QUEUE_DIR, `${repo.replace(/[^A-Za-z0-9_-]+/g, "__")}-${commit}.json`);

export function enqueue(api: string, repo: string, record: CheckpointRecord, opts: { force?: boolean } = {}): void {
	ensureDirs();
	const now = new Date().toISOString();
	// Idempotent on (repo, commit): a newer record for the same commit replaces the queued one.
	writeFileSync(fileFor(repo, record.commit), JSON.stringify({ api, repo, record, attempts: 0, firstAt: now, nextAt: now, ...(opts.force ? { force: true } : {}) } satisfies QueueItem), { mode: 0o600 });
}

export function queued(): QueueItem[] {
	if (!existsSync(QUEUE_DIR)) return [];
	return readdirSync(QUEUE_DIR)
		.filter((f) => f.endsWith(".json"))
		.flatMap((f) => {
			try {
				return [JSON.parse(readFileSync(join(QUEUE_DIR, f), "utf8")) as QueueItem];
			} catch {
				return [];
			}
		});
}

export interface SyncResult {
	sent: number;
	pending: number;
	failed: number;
}

/** C8: uploads due items with exponential backoff (1 min doubling, capped at 6 h), for up to 7 days. */
export async function flush(opts: { all?: boolean } = {}): Promise<SyncResult> {
	const result: SyncResult = { sent: 0, pending: 0, failed: 0 };
	for (const item of queued()) {
		const file = fileFor(item.repo, item.record.commit);
		if (!opts.all && Date.parse(item.nextAt) > Date.now()) {
			result.pending++;
			continue;
		}
		const creds = await loadCredentials(item.api);
		if (!creds) {
			result.pending++;
			continue;
		}
		try {
			await call(item.api, `/api/repos/${item.repo}/checkpoints${item.force ? "?force=1" : ""}`, { token: creds.token, body: item.record, timeoutMs: 20_000 });
			rmSync(file, { force: true });
			result.sent++;
			writeState({ lastUploadAt: new Date().toISOString() });
		} catch (error) {
			const status = error instanceof ApiError ? error.status : 0;
			if (status === 409) {
				// A different record already exists for this commit (edited or uploaded elsewhere): keep the server's.
				log(`checkpoint ${item.repo}@${item.record.commit.slice(0, 7)}: server has a different record; kept it`);
				rmSync(file, { force: true });
				result.sent++;
				continue;
			}
			if (status === 400 || status === 404 || status === 413) {
				// Will never succeed as is (bad record, repo gone or not yours, too large): drop it, keep a log line.
				log(`checkpoint ${item.repo}@${item.record.commit.slice(0, 7)}: dropped (HTTP ${status})`, JSON.stringify((error as ApiError).body).slice(0, 300));
				rmSync(file, { force: true });
				result.failed++;
				continue;
			}
			const attempts = item.attempts + 1;
			if (Date.now() - Date.parse(item.firstAt) > MAX_AGE_MS) {
				log(`checkpoint ${item.repo}@${item.record.commit.slice(0, 7)}: gave up after 7 days`);
				rmSync(file, { force: true });
				result.failed++;
				continue;
			}
			const delay = Math.min(60_000 * 2 ** (attempts - 1), 6 * 3600_000);
			// Another sync may have uploaded it meanwhile; don't bring it back.
			if (!existsSync(file)) continue;
			writeFileSync(file, JSON.stringify({ ...item, attempts, nextAt: new Date(Date.now() + delay).toISOString() }), { mode: 0o600 });
			log(`checkpoint ${item.repo}@${item.record.commit.slice(0, 7)}: retry in ${Math.round(delay / 1000)}s`, error);
			result.pending++;
		}
	}
	return result;
}
