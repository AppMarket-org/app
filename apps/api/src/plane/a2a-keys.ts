import { A2A_KEY_PREFIX, type A2AKey } from "@appmarket/shared";
import { env } from "cloudflare:workers";

/**
 * Repo A2A keys: an owner gives one to an outside agent or orchestrator so it can post and
 * follow tasks on this repo's board over A2A. A key reaches nothing else, and only its SHA-256
 * is stored.
 */
export async function hashKey(key: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return A2A_KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface KeyRow {
	id: string;
	name: string;
	prefix: string;
	created_by: string;
	creator: string | null;
	created_at: string;
	expires_at: string;
	last_used_at: string | null;
}

const toKey = (r: KeyRow): A2AKey => ({ id: r.id, name: r.name, prefix: r.prefix, createdBy: r.creator ?? "", createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at });

export async function createKey(repoId: string, userId: string, name: string, days: number): Promise<{ key: string; record: A2AKey }> {
	const key = newKey();
	const id = crypto.randomUUID();
	const expires = new Date(Date.now() + days * 86_400_000).toISOString();
	await env.DB.prepare("INSERT INTO a2a_keys (id, repo_id, name, key_hash, prefix, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, repoId, name, await hashKey(key), key.slice(0, A2A_KEY_PREFIX.length + 6), userId, expires)
		.run();
	return { key, record: (await listKeys(repoId)).find((k) => k.id === id)! };
}

/** Keys that still work, newest first. */
export async function listKeys(repoId: string): Promise<A2AKey[]> {
	const { results } = await env.DB.prepare(
		`SELECT k.*, u.name AS creator FROM a2a_keys k LEFT JOIN "user" u ON u.id = k.created_by
		 WHERE k.repo_id = ? AND k.revoked_at IS NULL AND k.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ORDER BY k.created_at DESC`,
	)
		.bind(repoId)
		.all<KeyRow>();
	return results.map(toKey);
}

export async function revokeKey(repoId: string, id: string): Promise<boolean> {
	const r = await env.DB.prepare("UPDATE a2a_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND repo_id = ? AND revoked_at IS NULL").bind(id, repoId).run();
	return r.meta.changes > 0;
}

/** The working key of this repo that `bearer` is, if any; records that it was used. */
export async function keyFor(repoId: string, bearer: string): Promise<{ id: string; name: string; createdBy: string } | null> {
	if (!bearer.startsWith(A2A_KEY_PREFIX)) return null;
	const row = await env.DB.prepare(
		"SELECT id, name, created_by FROM a2a_keys WHERE key_hash = ? AND repo_id = ? AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
	)
		.bind(await hashKey(bearer), repoId)
		.first<{ id: string; name: string; created_by: string }>();
	if (!row) return null;
	await env.DB.prepare("UPDATE a2a_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.id).run();
	return { id: row.id, name: row.name, createdBy: row.created_by };
}
