import { MEMORY_LIMITS, type MemoryChange, type MemoryNote, type MemorySource, redactSecrets } from "@appmarket/shared";
import { env } from "cloudflare:workers";

interface NoteRow {
	id: string;
	text: string;
	tags: string;
	pinned: number;
	public: number;
	created_by: string;
	source: MemorySource;
	session_id: string | null;
	redactions: number;
	created_at: string;
	updated_at: string;
	author: string | null;
}

const SELECT = `SELECT n.*, u.name AS author FROM memory_notes n LEFT JOIN "user" u ON u.id = n.created_by`;

const toNote = (r: NoteRow): MemoryNote => ({
	id: r.id,
	text: r.text,
	tags: JSON.parse(r.tags) as string[],
	pinned: r.pinned === 1,
	public: r.public === 1,
	createdBy: r.author ?? "",
	source: r.source,
	sessionId: r.session_id,
	redactions: r.redactions,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
});

export interface Actor {
	userId: string;
	source: MemorySource;
	sessionId: string | null;
}

/** #194: secrets are removed on the server too (the CLI redacts first), with the checkpoint patterns. */
const redact = (text: string) => redactSecrets(text);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listNotes(repoId: string, opts: { q?: string; tag?: string; limit?: number; pinnedOnly?: boolean } = {}): Promise<{ notes: MemoryNote[]; total: number }> {
	const where = ["n.repo_id = ?", "n.deleted_at IS NULL"];
	const binds: unknown[] = [repoId];
	if (opts.q) {
		for (const word of opts.q.trim().split(/\s+/).slice(0, 5)) {
			where.push("(n.text LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')");
			binds.push(`%${escapeLike(word)}%`, `%${escapeLike(word.toLowerCase())}%`);
		}
	}
	if (opts.tag) {
		where.push("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = ?)");
		binds.push(opts.tag.toLowerCase());
	}
	if (opts.pinnedOnly) where.push("n.pinned = 1");
	const limit = Math.min(Math.max(opts.limit ?? 100, 1), MEMORY_LIMITS.notesPerRepo);
	const [{ results }, count] = await Promise.all([
		env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ?`)
			.bind(...binds, limit)
			.all<NoteRow>(),
		env.DB.prepare(`SELECT COUNT(*) AS n FROM memory_notes n WHERE ${where.join(" AND ")}`)
			.bind(...binds)
			.first<{ n: number }>(),
	]);
	return { notes: results.map(toNote), total: count?.n ?? 0 };
}

export async function getNote(repoId: string, id: string): Promise<MemoryNote | null> {
	const row = await env.DB.prepare(`${SELECT} WHERE n.repo_id = ? AND n.id = ? AND n.deleted_at IS NULL`).bind(repoId, id).first<NoteRow>();
	return row ? toNote(row) : null;
}

function historyRow(id: string, version: number, action: MemoryChange["action"], note: { text: string; tags: string[]; pinned: boolean }, actor: Actor) {
	return env.DB.prepare("INSERT INTO memory_history (note_id, version, action, text, tags, pinned, changed_by, source, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
		id,
		version,
		action,
		note.text,
		JSON.stringify(note.tags),
		note.pinned ? 1 : 0,
		actor.userId,
		actor.source,
		actor.sessionId,
	);
}

export type CreateResult = { note: MemoryNote } | { error: "limit" };

export async function createNote(repoId: string, input: { text: string; tags: string[]; pinned: boolean; public?: boolean }, actor: Actor): Promise<CreateResult> {
	const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM memory_notes WHERE repo_id = ? AND deleted_at IS NULL").bind(repoId).first<{ n: number }>();
	if ((count?.n ?? 0) >= MEMORY_LIMITS.notesPerRepo) return { error: "limit" };
	const id = crypto.randomUUID();
	const { text, count: redactions } = redact(input.text);
	const note = { text, tags: input.tags, pinned: input.pinned };
	await env.DB.batch([
		env.DB.prepare("INSERT INTO memory_notes (id, repo_id, text, tags, pinned, public, created_by, source, session_id, redactions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
			id,
			repoId,
			text,
			JSON.stringify(input.tags),
			input.pinned ? 1 : 0,
			input.public ? 1 : 0,
			actor.userId,
			actor.source,
			actor.sessionId,
			redactions,
		),
		historyRow(id, 1, "create", note, actor),
	]);
	return { note: (await getNote(repoId, id))! };
}

export async function updateNote(repoId: string, id: string, change: { text?: string; tags?: string[]; pinned?: boolean; public?: boolean }, actor: Actor): Promise<MemoryNote | null> {
	const current = await getNote(repoId, id);
	if (!current) return null;
	const redacted = change.text !== undefined ? redact(change.text) : null;
	const next = { text: redacted?.text ?? current.text, tags: change.tags ?? current.tags, pinned: change.pinned ?? current.pinned };
	const version = await nextVersion(id);
	await env.DB.batch([
		env.DB.prepare("UPDATE memory_notes SET text = ?, tags = ?, pinned = ?, public = ?, redactions = redactions + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND repo_id = ?").bind(
			next.text,
			JSON.stringify(next.tags),
			next.pinned ? 1 : 0,
			(change.public ?? current.public) ? 1 : 0,
			redacted?.count ?? 0,
			id,
			repoId,
		),
		historyRow(id, version, "update", next, actor),
	]);
	return getNote(repoId, id);
}

/** Deleting hides the note; its history stays (until the repo is removed). */
export async function deleteNote(repoId: string, id: string, actor: Actor): Promise<boolean> {
	const current = await getNote(repoId, id);
	if (!current) return false;
	await env.DB.batch([
		env.DB.prepare("UPDATE memory_notes SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND repo_id = ?").bind(id, repoId),
		historyRow(id, await nextVersion(id), "delete", current, actor),
	]);
	return true;
}

async function nextVersion(id: string): Promise<number> {
	const row = await env.DB.prepare("SELECT MAX(version) AS v FROM memory_history WHERE note_id = ?").bind(id).first<{ v: number | null }>();
	return (row?.v ?? 0) + 1;
}

export async function noteHistory(repoId: string, id: string): Promise<MemoryChange[] | null> {
	const owned = await env.DB.prepare("SELECT 1 FROM memory_notes WHERE id = ? AND repo_id = ?").bind(id, repoId).first();
	if (!owned) return null;
	const { results } = await env.DB.prepare(
		`SELECT h.version, h.action, h.text, h.tags, h.pinned, u.name AS changed_by, h.source, h.session_id, h.changed_at FROM memory_history h LEFT JOIN "user" u ON u.id = h.changed_by WHERE h.note_id = ? ORDER BY h.version DESC`,
	)
		.bind(id)
		.all<{ version: number; action: MemoryChange["action"]; text: string; tags: string; pinned: number; changed_by: string | null; source: MemorySource; session_id: string | null; changed_at: string }>();
	return results.map((r) => ({
		version: r.version,
		action: r.action,
		text: r.text,
		tags: JSON.parse(r.tags) as string[],
		pinned: r.pinned === 1,
		changedBy: r.changed_by ?? "",
		source: r.source,
		sessionId: r.session_id,
		changedAt: r.changed_at,
	}));
}

/** #194: a removed repo's memory goes with its checkpoints (history included). */
export async function purgeRemovedRepoMemory(): Promise<number> {
	const removed = "SELECT id FROM repos WHERE state = 'removed'";
	const [history, notes] = await env.DB.batch([
		env.DB.prepare(`DELETE FROM memory_history WHERE note_id IN (SELECT id FROM memory_notes WHERE repo_id IN (${removed}))`),
		env.DB.prepare(`DELETE FROM memory_notes WHERE repo_id IN (${removed})`),
	]);
	return (history?.meta.changes ?? 0) + (notes?.meta.changes ?? 0);
}

/** #198: the notes published with an app (its page shows them when the repo is public). */
export async function publicNotes(repoId: string): Promise<MemoryNote[]> {
	const { results } = await env.DB.prepare(`${SELECT} WHERE n.repo_id = ? AND n.deleted_at IS NULL AND n.public = 1 ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 100`).bind(repoId).all<NoteRow>();
	return results.map(toNote);
}

/** #198: a fork starts with its source's memory: every note for the source's own people, the public ones otherwise. */
export async function copyNotes(fromRepoId: string, toRepoId: string, all: boolean, userId: string): Promise<number> {
	const { results } = await env.DB.prepare(`SELECT text, tags, pinned, public FROM memory_notes WHERE repo_id = ? AND deleted_at IS NULL ${all ? "" : "AND public = 1"} ORDER BY created_at LIMIT ?`)
		.bind(fromRepoId, MEMORY_LIMITS.notesPerRepo)
		.all<{ text: string; tags: string; pinned: number; public: number }>();
	const statements = results.flatMap((r) => {
		const id = crypto.randomUUID();
		const note = { text: r.text, tags: JSON.parse(r.tags) as string[], pinned: r.pinned === 1 };
		return [
			env.DB.prepare("INSERT INTO memory_notes (id, repo_id, text, tags, pinned, public, created_by, source) VALUES (?, ?, ?, ?, ?, 0, ?, 'web')").bind(id, toRepoId, r.text, r.tags, r.pinned, userId),
			historyRow(id, 1, "create", note, { userId, source: "web", sessionId: null }),
		];
	});
	for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
	return results.length;
}
