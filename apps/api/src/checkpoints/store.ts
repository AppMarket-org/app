import type { Checkpoint, CheckpointPage, CheckpointRecord, CheckpointState, CheckpointSummary, CheckpointVisibility, Harness } from "@appmarket/shared";

interface Row {
	repo_id: string;
	commit_sha: string;
	record: string;
	record_hash: string;
	state: CheckpointState;
	visibility: CheckpointVisibility;
	device: string | null;
	received_at: string;
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

async function hashOf(record: CheckpointRecord): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(record)));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toCheckpoint(row: Row, repoPath: string, viewer: CheckpointViewer): Checkpoint {
	const record = JSON.parse(row.record) as CheckpointRecord;
	const base: Checkpoint = { ...record, repo: repoPath, state: row.state, visibility: row.visibility, device: row.device, received_at: row.received_at };
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
		meta: { state: CheckpointState; visibility: CheckpointVisibility; uploadedBy: string; device: string | null; force: boolean },
	): Promise<PutResult> {
		const hash = await hashOf(record);
		const existing = await this.row(repo.id, record.commit);
		// A missing placeholder (#124) is replaced by the real checkpoint when it arrives late.
		if (existing?.state === "missing") meta = { ...meta, force: true };
		if (existing?.record_hash === hash) return { status: 200, checkpoint: toCheckpoint(existing, repo.path, "owner") };
		if (existing && !meta.force) return { status: 409, checkpoint: toCheckpoint(existing, repo.path, "owner") };
		await this.db
			.prepare(
				`INSERT INTO checkpoints (repo_id, commit_sha, record, record_hash, harness, model, session_id, branch, source, state, visibility, uploaded_by, device, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (repo_id, commit_sha) DO UPDATE SET record = excluded.record, record_hash = excluded.record_hash, harness = excluded.harness,
				   model = excluded.model, session_id = excluded.session_id, branch = excluded.branch, source = excluded.source, state = excluded.state,
				   uploaded_by = excluded.uploaded_by, device = excluded.device, created_at = excluded.created_at,
				   received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			)
			.bind(repo.id, record.commit, JSON.stringify(record), hash, record.harness, record.model, record.session_id, record.branch, record.source, meta.state, meta.visibility, meta.uploadedBy, meta.device, record.created_at)
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
		const { results } = await this.db
			.prepare(`SELECT harness, COUNT(*) AS n FROM checkpoints WHERE repo_id = ?${viewer === "owner" ? "" : " AND visibility != 'private'"} GROUP BY harness`)
			.bind(repoId)
			.all<{ harness: Harness; n: number }>();
		return { total: results.reduce((t, r) => t + r.n, 0), harnesses: Object.fromEntries(results.map((r) => [r.harness, r.n])) };
	}

	async setVisibility(repoId: string, sha: string, visibility: CheckpointVisibility): Promise<boolean> {
		const result = await this.db.prepare("UPDATE checkpoints SET visibility = ? WHERE repo_id = ? AND commit_sha = ?").bind(visibility, repoId, sha).run();
		return result.meta.changes > 0;
	}

	async setSessionVisibility(repoId: string, session: string, visibility: CheckpointVisibility): Promise<number> {
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
		record.prompts = [...record.prompts, { ts: new Date().toISOString(), text }];
		await this.db.prepare("UPDATE checkpoints SET record = ?, record_hash = ? WHERE repo_id = ? AND commit_sha = ?").bind(JSON.stringify(record), await hashOf(record), repoId, sha).run();
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

	async delete(repoId: string, sha: string): Promise<boolean> {
		const result = await this.db.prepare("DELETE FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).run();
		return result.meta.changes > 0;
	}

	private row(repoId: string, sha: string): Promise<Row | null> {
		return this.db.prepare("SELECT * FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).first<Row>();
	}
}
