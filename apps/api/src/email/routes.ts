import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { EMAIL_TOPICS, type EmailTopic, verifyUnsubscribe } from "./unsubscribe.ts";

type Ctx = { Variables: AuthVariables };

/** Turns one email topic on or off (topics are columns of email_preferences). */
const setTopic = (userId: string, topic: EmailTopic, on: boolean) =>
	env.DB.prepare(
		`INSERT INTO email_preferences (user_id, ${topic}) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET ${topic} = excluded.${topic}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
	)
		.bind(userId, on ? 1 : 0)
		.run();

async function preferences(userId: string) {
	const row = await env.DB.prepare("SELECT impacts, pulls, issues FROM email_preferences WHERE user_id = ?").bind(userId).first<{ impacts: number; pulls: number; issues: number }>();
	return { impacts: row?.impacts !== 0, pulls: row?.pulls !== 0, issues: row?.issues !== 0, sending: !!env.EMAIL_FROM };
}

/** #230: the signed-in user's email settings. Mounted under /api/me. */
export const emailPreferenceRoutes = new Hono<Ctx>()
	.get("/email-preferences", requireRole(), async (c) => c.json(await preferences(c.get("session")!.user.id)))
	.put("/email-preferences", requireRole(), async (c) => {
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const changes = EMAIL_TOPICS.filter((t) => body[t] !== undefined);
		if (!changes.length || changes.some((t) => typeof body[t] !== "boolean")) return c.json({ error: "invalid" }, 400);
		for (const t of changes) await setTopic(c.get("session")!.user.id, t, body[t] as boolean);
		return c.json(await preferences(c.get("session")!.user.id));
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
	await setTopic(u, t as EmailTopic, false);
	logEvent("email.unsubscribed", { topic: t });
	return c.json({ ok: true, topic: t });
});
