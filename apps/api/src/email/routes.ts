import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { verifyUnsubscribe } from "./unsubscribe.ts";

type Ctx = { Variables: AuthVariables };

const setImpacts = (userId: string, on: boolean) =>
	env.DB.prepare(
		"INSERT INTO email_preferences (user_id, impacts) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET impacts = excluded.impacts, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
	)
		.bind(userId, on ? 1 : 0)
		.run();

/** #230: the signed-in user's email settings. Mounted under /api/me. */
export const emailPreferenceRoutes = new Hono<Ctx>()
	.get("/email-preferences", requireRole(), async (c) => {
		const row = await env.DB.prepare("SELECT impacts FROM email_preferences WHERE user_id = ?").bind(c.get("session")!.user.id).first<{ impacts: number }>();
		return c.json({ impacts: row?.impacts !== 0, sending: !!env.EMAIL_FROM });
	})
	.put("/email-preferences", requireRole(), async (c) => {
		const body = await c.req.json<{ impacts?: unknown }>().catch(() => ({}) as { impacts?: unknown });
		if (typeof body.impacts !== "boolean") return c.json({ error: "invalid" }, 400);
		await setImpacts(c.get("session")!.user.id, body.impacts);
		return c.json({ impacts: body.impacts, sending: !!env.EMAIL_FROM });
	});

/**
 * #230: unsubscribe without signing in. POST is the RFC 8058 one-click endpoint (mail apps call it
 * from the List-Unsubscribe header) and what the /email/unsubscribe page uses; the signature binds
 * the link to the user and topic. Mounted under /api/email.
 */
export const unsubscribeRoutes = new Hono<Ctx>().post("/unsubscribe", async (c) => {
	const u = c.req.query("u") ?? "";
	const t = c.req.query("t") ?? "";
	if (!(await verifyUnsubscribe(env.BETTER_AUTH_SECRET, u, t, c.req.query("s") ?? ""))) return c.json({ error: "invalid_link" }, 400);
	const exists = await env.DB.prepare('SELECT 1 FROM "user" WHERE id = ?').bind(u).first();
	if (!exists) return c.json({ error: "invalid_link" }, 400);
	await setImpacts(u, false);
	logEvent("email.unsubscribed", { topic: t });
	return c.json({ ok: true, topic: t });
});
