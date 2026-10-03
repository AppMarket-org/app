import type { Role } from "@appmarket/shared";
import { createMiddleware } from "hono/factory";
import { env } from "cloudflare:workers";
import { OwnerStore } from "../owners/store.ts";
import { auth, type Session } from "./auth.ts";
import { deviceMayCall, deviceMayCallAuth } from "./scopes.ts";

/**
 * The Better Auth session plus the organizations (#102) the user belongs to, and for device-login
 * sessions (#107) the granted scopes (null for browser sessions: full access).
 */
export type AppSession = Session & { orgIds: string[]; deviceScopes: string[] | null };
export type AuthVariables = { session: AppSession | null };

/** Loads the current session (or null) and the user's organization ids into the Hono context. */
export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) {
		c.set("session", null);
		return next();
	}
	const scopes = (session.session as { scopes?: string | null }).scopes;
	const deviceScopes = scopes == null ? null : scopes.split(" ").filter(Boolean);
	// #107: device sessions reach only the routes their scopes allow; everything else is 403.
	if (deviceScopes && !deviceMayCall(deviceScopes, c.req.method, new URL(c.req.url).pathname)) {
		return c.json({ error: "insufficient_scope" }, 403);
	}
	c.set("session", { ...session, orgIds: await new OwnerStore(env.DB).orgIdsOf(session.user.id), deviceScopes });
	await next();
});

/** #107: Better Auth's own endpoints, for device sessions: only their own session and sign-out. */
export const deviceAuthGate = createMiddleware(async (c, next) => {
	if (c.req.header("authorization")?.toLowerCase().startsWith("bearer ")) {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		const scopes = (session?.session as { scopes?: string | null } | undefined)?.scopes;
		if (scopes != null && !deviceMayCallAuth(new URL(c.req.url).pathname)) return c.json({ error: "insufficient_scope" }, 403);
	}
	await next();
});

/** Rejects requests without a session (401) or without one of the given roles (403). */
export function requireRole(...roles: Role[]) {
	return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
		const session = c.get("session");
		if (!session) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		if (roles.length > 0 && !roles.includes(session.user.role as Role)) {
			return c.json({ error: "forbidden" }, 403);
		}
		await next();
	});
}
