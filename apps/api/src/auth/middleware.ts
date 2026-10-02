import type { Role } from "@appmarket/shared";
import { createMiddleware } from "hono/factory";
import { auth, type Session } from "./auth.ts";

export type AuthVariables = { session: Session | null };

/** Loads the current session (or null) into the Hono context. */
export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	c.set("session", await auth.api.getSession({ headers: c.req.raw.headers }));
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
