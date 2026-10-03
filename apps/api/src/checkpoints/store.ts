import type { Checkpoint, CheckpointPage, CheckpointRecord, CheckpointState, CheckpointVisibility } from "@appmarket/shared";

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

/** Who is reading: owners see everything; others see prompt details only on non-private checkpoints. */
export type CheckpointViewer = "owner" | "public";

export type PutResult = { status: 201 | 200; checkpoint: Checkpoint } | { status: 409; checkpoint: Checkpoint };

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
	// PRD "Visibility": commit metadata is visible wherever the commit is; prompts, assistant text,
	// tools and usage follow the checkpoint's visibility.
	if (viewer === "owner" || row.visibility !== "private") return base;
	const { prompts: _p, assistant_summary: _a, tools: _t, usage: _u, ...metadata } = base;
	return metadata;
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
		return row ? toCheckpoint(row, repo.path, viewer) : null;
	}

	/** Newest first; `before` is the previous page's last received_at. */
	async list(
		repo: { id: string; path: string },
		viewer: CheckpointViewer,
		filter: { before?: string; branch?: string; session?: string; limit?: number } = {},
	): Promise<CheckpointPage> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
		const where = ["repo_id = ?"];
		const params: unknown[] = [repo.id];
		if (filter.before) (where.push("received_at < ?"), params.push(filter.before));
		if (filter.branch) (where.push("branch = ?"), params.push(filter.branch));
		if (filter.session) (where.push("session_id = ?"), params.push(filter.session));
		const { results } = await this.db
			.prepare(`SELECT * FROM checkpoints WHERE ${where.join(" AND ")} ORDER BY received_at DESC LIMIT ?`)
			.bind(...params, limit + 1)
			.all<Row>();
		const page = results.slice(0, limit);
		return { items: page.map((r) => toCheckpoint(r, repo.path, viewer)), next: results.length > limit ? page.at(-1)!.received_at : null };
	}

	async setVisibility(repoId: string, sha: string, visibility: CheckpointVisibility): Promise<boolean> {
		const result = await this.db.prepare("UPDATE checkpoints SET visibility = ? WHERE repo_id = ? AND commit_sha = ?").bind(visibility, repoId, sha).run();
		return result.meta.changes > 0;
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

	async delete(repoId: string, sha: string): Promise<boolean> {
		const result = await this.db.prepare("DELETE FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).run();
		return result.meta.changes > 0;
	}

	private row(repoId: string, sha: string): Promise<Row | null> {
		return this.db.prepare("SELECT * FROM checkpoints WHERE repo_id = ? AND commit_sha = ?").bind(repoId, sha).first<Row>();
	}
}
