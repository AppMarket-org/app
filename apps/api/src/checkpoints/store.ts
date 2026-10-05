import { redactSecrets } from "@appmarket/shared";
import { redactRecord } from "./redact.ts";
import type { Checkpoint, CheckpointAccess, CheckpointPage, CheckpointRecord, CheckpointState, CheckpointSummary, CheckpointVisibility, Harness } from "@appmarket/shared";

interface Row {
	repo_id: string;
	commit_sha: string;
	record: string;
	record_hash: string;
	state: CheckpointState;
	visibility: CheckpointVisibility;
	device: string | null;
	received_at: string;
	server_redactions: number;
	transcript_bytes: number | null;
}

/** Who is reading: owners see everything; everyone else only checkpoints the owner published (listing or public). */
export type CheckpointViewer = "owner" | "public";

export type PutResult = { status: 201 | 200; checkpoint: Checkpoint } | { status: 409; checkpoint: Checkpoint };

/** A pushed commit as Artifacts reports it. */
export interface PushedCommit {
	hash: string;
	parents: string[];
	author: { name: string; email: string };
	committedAt: number;
}

/** Artifacts timestamps may be seconds or milliseconds. */
function toIso(t: number): string {
	return new Date(t < 1e12 ? t * 1000 : t).toISOString();
}

/** The record for a pushed commit that arrived without a checkpoint. */
function placeholder(c: PushedCommit, at: string): CheckpointRecord {
	return {
		schema: "appmarket.checkpoint/1",
		commit: c.hash,
		parents: c.parents,
		branch: "",
		author: c.author,
		harness: "none",
		harness_version: "",
		session_id: "",
		model: "",
		effort: { raw: "", level: "unknown" },
		effort_metrics: { turns: 0, wall_clock_s: 0, tool_calls: 0, retries: 0, reasoning_tokens: null },
		prompts: [],
		assistant_summary: "",
		tools: [],
		usage: { input_tokens: null, output_tokens: null, cost_usd: null },
		files: [],
		redactions: 0,
		source: "harness",
		created_at: at,
	};
}

/** #137: the prompts as one searchable text. */
const promptText = (record: CheckpointRecord) => record.prompts.map((p) => p.text).join(" ");

/** Stable JSON (sorted keys) so the same record always hashes the same. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export async function hashOf(record: CheckpointRecord): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(record)));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toCheckpoint(row: Row, repoPath: string, viewer: CheckpointViewer): Checkpoint {
	const record = JSON.parse(row.record) as CheckpointRecord;
	const base: Checkpoint = {
		...record,
		repo: repoPath,
		state: row.state,
		visibility: row.visibility,
		device: row.device,
		received_at: row.received_at,
		...(row.server_redactions ? { server_redactions: row.server_redactions } : {}),
		...(row.transcript_bytes ? { transcript_bytes: row.transcript_bytes } : {}),
	};
	if (viewer === "owner") return base;
	// #117: others never see private checkpoints (callers filter them out), the author's email or the device name.
	return { ...base, author: { name: base.author.name, email: "" }, device: null };
}

/** Checkpoints PRD (#111): one record per (repo, commit), idempotent. */
export class CheckpointStore {
	constructor(private readonly db: D1Database) {}

	async put(
		repo: { id: string; path: string },
		record: CheckpointRecord,
		meta: { state: CheckpointState; visibility: CheckpointVisibility; uploadedBy: string; device: string | null; force: boolean; serverRedactions?: number },
	): Promise<PutResult> {
		const hash = await hashOf(record);
		const existing = await this.row(repo.id, record.commit);
		// A missing placeholder (#124) is replaced by the real checkpoint when it arrives late.
		if (existing?.state === "missing") meta = { ...meta, force: true };
		if (existing?.record_hash === hash) return { status: 200, checkpoint: toCheckpoint(existing, repo.path, "owner") };
		if (existing && !meta.force) return { status: 409, checkpoint: toCheckpoint(existing, repo.path, "owner") };
		await this.db
			.prepare(
				`INSERT INTO checkpoints (repo_id, commit_sha, record, record_hash, harness, model, session_id, branch, source, state, visibility, uploaded_by, device, created_at, server_redactions, prompt_text)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (repo_id, commit_sha) DO UPDATE SET record = excluded.record, record_hash = excluded.record_hash, harness = excluded.harness,
				   model = excluded.model, session_id = excluded.session_id, branch = excluded.branch, source = excluded.source, state = excluded.state,
				   uploaded_by = excluded.uploaded_by, device = excluded.device, created_at = excluded.created_at, server_redactions = excluded.server_redactions, prompt_text = excluded.prompt_text,
				   received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			)
			.bind(repo.id, record.commit, JSON.stringify(record), hash, record.harness, record.model, record.session_id, record.branch, record.source, meta.state, meta.visibility, meta.uploadedBy, meta.device, record.created_at, meta.serverRedactions ?? 0, promptText(record))
			.run();
		// A replaced record keeps the owner's visibility choice (ON CONFLICT leaves it unchanged).
		return { status: existing ? 200 : 201, checkpoint: toCheckpoint((await this.row(repo.id, record.commit))!, repo.path, "owner") };
	}

	async get(repo: { id: string; path: string }, sha: string, viewer: CheckpointViewer): Promise<Checkpoint | null> {
		const row = await this.row(repo.id, sha);
		return row && (viewer === "owner" || row.visibility !== "private") ? toCheckpoint(row, repo.path, viewer) : null;
	}

	/** Newest first; `before` is the previous page's last received_at. */
	async list(
		repo: { id: string; path: string },
		viewer: CheckpointViewer,
		filter: { before?: string; branch?: string; session?: string; limit?: number } = {},
	): Promise<CheckpointPage> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
		const where = viewer === "owner" ? ["repo_id = ?"] : ["repo_id = ?", "visibility != 'private'"];
		const params: unknown[] = [repo.id];
		if (filter.before) (where.push("received_at < ?"), params.push(filter.before));
		if (filter.branch) (where.push("branch = ?"), params.push(filter.branch));
		if (filter.session) (where.push("session_id = ?"), params.push(filter.session));
		const { results } = await this.db
			.prepare(`SELECT * FROM checkpoints WHERE ${where.join(" AND ")} ORDER BY received_at DESC LIMIT ?`)
			.bind(...params, limit + 1)
			.all<Row>();
		const page = results.slice(0, limit);
		return {
			items: page.map((r) => toCheckpoint(r, repo.path, viewer)),
			next: results.length > limit ? page.at(-1)!.received_at : null,
			...(filter.before ? {} : { summary: await this.summary(repo.id, viewer) }),
		};
	}

	async summary(repoId: string, viewer: CheckpointViewer): Promise<CheckpointSummary> {
		// #137: counts for the badge, no prompt text: all commits with a checkpoint (any visibility)
		// and those whose prompts the developer published.
		const counts = await this.db
			.prepare(`SELECT COUNT(*) AS commits, SUM(CASE WHEN visibility != 'private' AND prompt_text != '' THEN 1 ELSE 0 END) AS published FROM checkpoints WHERE repo_id = ? AND state != 'missing'`)
			.bind(repoId)
			.first<{ commits: number; published: number | null }>();
		const { results } = await this.db
			.prepare(`SELECT harness, COUNT(*) AS n FROM checkpoints WHERE repo_id = ?${viewer === "owner" ? "" : " AND visibility != 'private'"} GROUP BY harness`)
			.bind(repoId)
			.all<{ harness: Harness; n: number }>();
		return {
			total: results.reduce((t, r) => t + r.n, 0),
			harnesses: Object.fromEntries(results.map((r) => [r.harness, r.n])),
			commits: counts?.commits ?? 0,
			withPublishedPrompts: counts?.published ?? 0,
		};
	}

	/**
	 * #128: re-runs the server redaction over stored records before they become visible (patterns
	 * may have grown since upload). Returns how many secrets it found.
	 */
	async rescan(repoId: string, where: { sha: string } | { session: string }): Promise<number> {
		const { results } = await this.db
			.prepare(`SELECT * FROM checkpoints WHERE repo_id = ? AND ${"sha" in where ? "commit_sha" : "session_id"} = ?`)
			.bind(repoId, "sha" in where ? where.sha : where.session)
			.all<Row>();
		let found = 0;
		for (const row of results) {
			const { record, count } = redactRecord(JSON.parse(row.record) as CheckpointRecord);
			if (!count) continue;
			found += count;
			await this.db
				.prepare("UPDATE checkpoints SET record = ?, record_hash = ?, server_redactions = server_redactions + ?, prompt_text = ? WHERE repo_id = ? AND commit_sha = ?")
				.bind(JSON.stringify(record), await hashOf(record), count, promptText(record), repoId, row.commit_sha)
				.run();
		}
		return found;
	}

	/** #128 audit: stored checkpoints that still contain a known secret format. */
	async audit(): Promise<{ scanned: number; withSecrets: { repoId: string; commit: string }[] }> {
		const withSecrets: { repoId: string; commit: string }[] = [];
		let scanned = 0;
		let after = "";
		for (;;) {
			const { results } = await this.db.prepare("SELECT repo_id, commit_sha, record FROM checkpoints WHERE repo_id || commit_sha > ? ORDER BY repo_id || commit_sha LIMIT 500").bind(after).all<{ repo_id: string; commit_sha: string; record: string }>();
			if (!results.length) break;
			for (const r of results) {
				scanned++;
				if (redactRecord(JSON.parse(r.record) as CheckpointRecord).count) withSecrets.push({ repoId: r.repo_id, commit: r.commit_sha });
			}
			after = results.at(-1)!.repo_id + results.at(-1)!.commit_sha;
		}
		return { scanned, withSecrets };
	}

	async setVisibility(repoId: string, sha: string, visibility: CheckpointVisibility): Promise<boolean> {
		if (visibility !== "private") await this.rescan(repoId, { sha });
		const result = await this.db.prepare("UPDATE checkpoints SET visibility = ? WHERE repo_id = ? AND commit_sha = ?").bind(visibility, repoId, sha).run();
		return result.meta.changes > 0;
	}

	/** #130: how many checkpoints of a session are private now (they would become visible). */
	async privateInSession(repoId: string, session: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE repo_id = ? AND session_id = ? AND visibility = 'private'").bind(repoId, session).first<{ n: number }>();
		return row?.n ?? 0;
	}

	async setSessionVisibility(repoId: string, session: string, visibility: CheckpointVisibility): Promise<number> {
		if (visibility !== "private") await this.rescan(repoId, { session });
		const result = await this.db.prepare("UPDATE checkpoints SET visibility = ? WHERE repo_id = ? AND session_id = ?").bind(visibility, repoId, session).run();
		return result.meta.changes;
	}

	async setRepoDefault(repoId: string, visibility: CheckpointVisibility): Promise<void> {
		await this.db.prepare("UPDATE repos SET checkpoint_visibility = ? WHERE id = ?").bind(visibility, repoId).run();
	}

	/** `appmarket record --prompt … --for <sha>`: a prompt added after the commit. */
	async addPrompt(repoId: string, sha: string, text: string): Promise<boolean> {
		const row = await this.row(repoId, sha);
		if (!row) return false;
		const record = JSON.parse(row.record) as CheckpointRecord;
		// #128: a late prompt gets the server pass too.
		const clean = redactSecrets(text);
		record.prompts = [...record.prompts, { ts: new Date().toISOString(), text: clean.text }];
		record.redactions += clean.count;
		await this.db.prepare("UPDATE checkpoints SET record = ?, record_hash = ?, prompt_text = ? WHERE repo_id = ? AND commit_sha = ?").bind(JSON.stringify(record), await hashOf(record), promptText(record), repoId, sha).run();
		return true;
	}

	/** Pending checkpoints whose commits have since reached the repo. */
	async attach(repoId: string, shas: string[]): Promise<void> {
		if (!shas.length) return;
		await this.db
			.prepare(`UPDATE checkpoints SET state = 'attached' WHERE repo_id = ? AND state = 'pending' AND commit_sha IN (${shas.map(() => "?").join(",")})`)
			.bind(repoId, ...shas)
			.run();
	}

	/**
	 * #124: after a push, checkpoints of pushed commits become attached, and pushed commits made
	 * since checkpoints were set up get a `missing` placeholder. Idempotent.
	 */
	async reconcilePushed(repo: { id: string; defaultVisibility: CheckpointVisibility }, commits: PushedCommit[], pushedAt: string): Promise<{ attached: number; missing: number }> {
		const first = await this.db.prepare("SELECT MIN(created_at) AS t FROM checkpoints WHERE repo_id = ? AND state != 'missing'").bind(repo.id).first<{ t: string | null }>();
		const shas = commits.map((c) => c.hash);
		let attached = 0;
		for (let i = 0; i < shas.length; i += 90) {
			const chunk = shas.slice(i, i + 90);
			const res = await this.db
				.prepare(`UPDATE checkpoints SET state = 'attached' WHERE repo_id = ? AND state = 'pending' AND commit_sha IN (${chunk.map(() => "?").join(",")})`)
				.bind(repo.id, ...chunk)
				.run();
			attached += res.meta.changes;
		}
		let missing = 0;
		if (first?.t) {
			const since = Date.parse(first.t);
			const inserts = [];
			for (const c of commits) {
				const at = toIso(c.committedAt);
				if (Date.parse(at) < since) continue;
				const record = placeholder(c, at);
				inserts.push(
					this.db
						.prepare(
							`INSERT INTO checkpoints (repo_id, commit_sha, record, record_hash, harness, source, state, visibility, created_at, received_at)
							 VALUES (?, ?, ?, ?, 'none', 'harness', 'missing', ?, ?, ?) ON CONFLICT (repo_id, commit_sha) DO NOTHING`,
						)
						.bind(repo.id, c.hash, JSON.stringify(record), await hashOf(record), repo.defaultVisibility, at, at),
				);
			}
			for (let i = 0; i < inserts.length; i += 50) {
				const results = await this.db.batch(inserts.slice(i, i + 50));
				missing += results.reduce((n, r) => n + r.meta.changes, 0);
			}
		}
		await this.db.prepare("UPDATE repos SET checkpoints_reconciled_at = ? WHERE id = ?").bind(pushedAt, repo.id).run();
		return { attached, missing };
	}

	async reconciledAt(repoId: string): Promise<string | null> {
		return (await this.db.prepare("SELECT checkpoints_reconciled_at AS t FROM repos WHERE id = ?").bind(repoId).first<{ t: string | null }>())?.t ?? null;
	}

	/** #131: every checkpoint in these owners' repos, oldest first, as JSONL lines (owner view). */
	async *exportLines(ownerIds: string[]): AsyncGenerator<string> {
		if (!ownerIds.length) return;
		let after = "";
		for (;;) {
			const { results } = await this.db
				.prepare(
					`SELECT c.*, o.handle || '/' || r.slug AS path FROM checkpoints c JOIN repos r ON r.id = c.repo_id JOIN owners o ON o.id = r.owner_id
					 WHERE r.owner_id IN (${ownerIds.map(() => "?").join(",")}) AND c.repo_id || c.commit_sha > ? ORDER BY c.repo_id || c.commit_sha LIMIT 200`,
				)
				.bind(...ownerIds, after)
				.all<Row & { path: string }>();
			if (!results.length) return;
			for (const row of results) yield JSON.stringify(toCheckpoint(row, row.path, "owner")) + "\n";
			after = results.at(-1)!.repo_id + results.at(-1)!.commit_sha;
		}
	}

	/** #131 retention: checkpoints of removed repos are deleted (the cron runs this every minute). */
	async purgeRemovedRepos(onTranscript?: (repoId: string, sha: string) => Promise<void>): Promise<number> {
		if (onTranscript) {
			const { results } = await this.db.prepare("SELECT repo_id, commit_sha FROM checkpoints WHERE transcript_ref IS NOT NULL AND repo_id IN (SELECT id FROM repos WHERE state = 'removed') LIMIT 500").all<{ repo_id: string; commit_sha: string }>();
			for (const r of results) await onTranscript(r.repo_id, r.commit_sha);
		}
		const result = await this.db.prepare("DELETE FROM checkpoints WHERE repo_id IN (SELECT id FROM repos WHERE state = 'removed')").run();
		return result.meta.changes;
	}

	/** #135 */
	async logAccess(repoId: string, adminId: string, reportId: string, privateCount: number): Promise<void> {
		await this.db.prepare("INSERT INTO checkpoint_access_log (repo_id, admin_id, report_id, private_count) VALUES (?, ?, ?, ?)").bind(repoId, adminId, reportId, privateCount).run();
	}

	async accessLog(repoId: string): Promise<CheckpointAccess[]> {
		const { results } = await this.db
			.prepare(`SELECT l.viewed_at, l.private_count, r.reason FROM checkpoint_access_log l JOIN repo_reports r ON r.id = l.report_id WHERE l.repo_id = ? ORDER BY l.viewed_at DESC LIMIT 100`)
			.bind(repoId)
			.all<{ viewed_at: string; private_count: number; reason: string }>();
		return results.map((r) => ({ viewedAt: r.viewed_at, reason: r.reason, privateCount: r.private_count }));
	}

	async delete(repoId: string, sha: string): Promise<boolean> {
		const result = await this.db.prepare("DELETE FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).run();
		return result.meta.changes > 0;
	}

	private row(repoId: string, sha: string): Promise<Row | null> {
		return this.db.prepare("SELECT * FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).first<Row>();
	}
}
