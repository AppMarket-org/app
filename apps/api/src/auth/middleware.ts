import type { Role } from "@appmarket/shared";
import { createMiddleware } from "hono/factory";
import { env } from "cloudflare:workers";
import { OwnerStore } from "../owners/store.ts";
import { auth, type Session } from "./auth.ts";

/** The Better Auth session plus the organizations (#102) the user belongs to. */
export type AppSession = Session & { orgIds: string[] };
export type AuthVariables = { session: AppSession | null };

/** Loads the current session (or null) and the user's organization ids into the Hono context. */
export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	c.set("session", session ? { ...session, orgIds: await new OwnerStore(env.DB).orgIdsOf(session.user.id) } : null);
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
