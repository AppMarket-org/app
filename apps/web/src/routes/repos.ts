import { env } from "cloudflare:workers";

// PRD Phase 0, step 7. Unauthenticated: run on localhost only, never deploy this route as-is.
// Phase 1 puts it behind identity (R11) and rate limiting (R20), and stops returning write tokens (R3).
export async function createRepo(request: Request): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as { name?: string };
	const name = body.name ?? "appmarket-first-repo";

	const created = await env.ARTIFACTS.create(name);
	return Response.json({ name: created.name, remote: created.remote, token: created.token });
}
