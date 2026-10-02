import { env } from "cloudflare:workers";

// Phase 0 hand-off: mint a token for an existing repo so the owner can push their own code.
// Unauthenticated: localhost only, never deploy as-is. Replaced by the authenticated route in R3.
export async function createToken(request: Request, name: string): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as { scope?: "read" | "write"; ttl?: number };

	using repo = await env.ARTIFACTS.get(name);
	const token = await repo.createToken(body.scope ?? "write", body.ttl ?? 3600);
	return Response.json({ name, remote: (await repo.info()).remote, token: token.plaintext, expiresAt: token.expiresAt });
}
