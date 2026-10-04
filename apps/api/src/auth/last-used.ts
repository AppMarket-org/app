import { env } from "cloudflare:workers";
import { ipPrefix } from "./ip-prefix.ts";

const EVERY_MS = 5 * 60_000;

/** Records last use at most every five minutes (one conditional write). */
export async function touchSession(sessionId: string, ip: string | null | undefined, now = Date.now()): Promise<void> {
	await env.DB.prepare(`UPDATE "session" SET lastUsedAt = ?, lastIpPrefix = ? WHERE id = ? AND (lastUsedAt IS NULL OR lastUsedAt < ?)`)
		.bind(new Date(now).toISOString(), ipPrefix(ip), sessionId, new Date(now - EVERY_MS).toISOString())
		.run();
}
