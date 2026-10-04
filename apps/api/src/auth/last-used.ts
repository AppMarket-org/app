import { env } from "cloudflare:workers";

/** #133: the network a request came from, without the host part: a.b.c.0/24 or x:y:z::/48. */
export function ipPrefix(ip: string | null | undefined): string | null {
	if (!ip) return null;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
	if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
	if (ip.includes(":")) {
		const [head] = ip.trim().split("::");
		const groups = (head ?? "").split(":").filter(Boolean);
		while (groups.length < 3) groups.push("0");
		return `${groups.slice(0, 3).join(":").toLowerCase()}::/48`;
	}
	return null;
}

const EVERY_MS = 5 * 60_000;

/** Records last use at most every five minutes (one conditional write). */
export async function touchSession(sessionId: string, ip: string | null | undefined, now = Date.now()): Promise<void> {
	await env.DB.prepare(`UPDATE "session" SET lastUsedAt = ?, lastIpPrefix = ? WHERE id = ? AND (lastUsedAt IS NULL OR lastUsedAt < ?)`)
		.bind(new Date(now).toISOString(), ipPrefix(ip), sessionId, new Date(now - EVERY_MS).toISOString())
		.run();
}
