import { reportInputSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { canView } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { clientIp, rateLimit } from "../rate-limit.ts";
import { Reports } from "./reports.ts";
import { verifyTurnstile } from "./turnstile.ts";

type Ctx = { Variables: AuthVariables };
const perUserOrIp = (c: Context<Ctx>) => c.get("session")?.user.id ?? `ip:${clientIp(c)}`;

/** PRD R18: anyone can report a visible repo (Turnstile + rate limit). Mounted under /api/repos. */
export const reportRoutes = new Hono<Ctx>().post(
	"/:owner/:slug/reports",
	rateLimit<Ctx>(() => env.RL_REPORT, perUserOrIp, env.RATE_LIMIT_CONFIG.REPORT.period),
	async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, c.req.header("x-captcha-response"), c.req.header("cf-connecting-ip")))) {
			return c.json({ error: "captcha_failed" }, 403);
		}
		const input = reportInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid", issues: input.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
		const id = await new Reports(env.DB).add(repo.id, input.data, c.get("session")?.user.id ?? null);
		return c.json({ id }, 201);
	},
);

const resolveSchema = z.object({ resolution: z.enum(["dismissed", "taken_down"]), note: z.string().trim().max(500).optional() });

/** PRD R18: admin report queue. Mounted under /api/admin (behind Cloudflare Access at deploy). */
export const adminReportRoutes = new Hono<Ctx>()
	.use(requireRole("admin"))
	.get("/reports", async (c) => {
		const status = c.req.query("status") === "resolved" ? "resolved" : "open";
		return c.json({ items: await new Reports(env.DB).list(status) });
	})
	.post("/reports/:id/resolve", async (c) => {
		const body = resolveSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "invalid" }, 400);
		const text = body.data.note ? `${body.data.resolution}: ${body.data.note}` : body.data.resolution;
		const ok = await new Reports(env.DB).resolve(c.req.param("id"), c.get("session")!.user.id, text);
		return ok ? c.json({ resolved: true }) : c.json({ error: "not_found" }, 404);
	});
