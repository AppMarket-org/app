import { env } from "cloudflare:workers";
import { open, seal } from "./transcript-crypto.ts";

/**
 * #129: transcripts (the full record of a checkpoint too large for D1) are encrypted with a key
 * per account: HKDF-SHA-256 of the TRANSCRIPT_KEY secret with the owning account's id, used for
 * AES-256-GCM with a random IV and the repo and commit as additional data. Without the secret,
 * the R2 objects are unreadable; D1 holds only the version reference.
 */
export const TRANSCRIPT_LIMIT = 10 * 1024 * 1024;
const VERSION = "v1";
const key = (repoId: string, sha: string) => `transcripts/${repoId}/${sha}`;
export async function putTranscript(repo: { id: string; ownerId: string }, sha: string, json: string): Promise<number> {
	const plain = new TextEncoder().encode(json);
	await env.MEDIA.put(key(repo.id, sha), await seal(env.TRANSCRIPT_KEY, repo.ownerId, `${repo.id}:${sha}`, plain), { httpMetadata: { contentType: "application/octet-stream" } });
	await env.DB.prepare("UPDATE checkpoints SET transcript_ref = ?, transcript_bytes = ? WHERE repo_id = ? AND commit_sha = ?").bind(VERSION, plain.length, repo.id, sha).run();
	return plain.length;
}

export async function getTranscript(repo: { id: string; ownerId: string }, sha: string): Promise<string | null> {
	const object = await env.MEDIA.get(key(repo.id, sha));
	if (!object) return null;
	return new TextDecoder().decode(await open(env.TRANSCRIPT_KEY, repo.ownerId, `${repo.id}:${sha}`, new Uint8Array(await object.arrayBuffer())));
}

export async function deleteTranscript(repoId: string, sha: string): Promise<void> {
	await env.MEDIA.delete(key(repoId, sha));
}
