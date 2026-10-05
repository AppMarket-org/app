import { env } from "cloudflare:workers";
import { Hono } from "hono";
import semver from "semver";
import { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { OwnerStore } from "../owners/store.ts";
import { type ImpactRow, syncImpact } from "./store.ts";

type Ctx = { Variables: AuthVariables };

const createSchema = z.object({
	kind: z.enum(["package", "rule"]),
	target: z.string().trim().min(1).max(214),
	affected: z.string().trim().max(200).optional(),
	title: z.string().trim().min(5).max(160),
	guidance: z.string().trim().min(5).max(4000),
});

const PATH = "o.handle || '/' || r.slug";

/** #69 (G2): impacts for admins. Mounted under /api/admin. */
export const adminImpactRoutes = new Hono<Ctx>()
	.use(requireRole("admin"))
	.get("/impacts", async (c) => {
		const { results } = await env.DB.prepare(
			`SELECT i.*, (SELECT COUNT(*) FROM impact_repos x WHERE x.impact_id = i.id AND x.resolved_at IS NULL) AS open_repos,
			   (SELECT COUNT(*) FROM impact_repos x WHERE x.impact_id = i.id AND x.resolved_at IS NOT NULL) AS resolved_repos
			 FROM impacts i ORDER BY i.closed_at IS NOT NULL, i.created_at DESC LIMIT 100`,
		).all<ImpactRow & { open_repos: number; resolved_repos: number }>();
		return c.json({ items: results });
	})
	.post("/impacts", async (c) => {
		const input = createSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid", issues: input.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
		if (input.data.kind === "package" && input.data.affected && !semver.validRange(input.data.affected)) return c.json({ error: "invalid", issues: [{ path: "affected", message: "Use a version range such as <4.6.2 or >=1.0.0 <1.4.2." }] }, 400);
		const id = crypto.randomUUID();
		await env.DB.prepare("INSERT INTO impacts (id, kind, target, affected, title, guidance, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.bind(id, input.data.kind, input.data.kind === "package" ? input.data.target.toLowerCase() : input.data.target, input.data.affected || null, input.data.title, input.data.guidance, c.get("session")!.user.id)
			.run();
		const impact = (await env.DB.prepare("SELECT * FROM impacts WHERE id = ?").bind(id).first<ImpactRow>())!;
		const result = await syncImpact(impact);
		logEvent("impacts.created", { impact: id, kind: impact.kind, target: impact.target, affected: result.affected });
		return c.json({ ...impact, ...result }, 201);
	})
	.get("/impacts/:id", async (c) => {
		const impact = await env.DB.prepare("SELECT * FROM impacts WHERE id = ?").bind(c.req.param("id")).first<ImpactRow>();
		if (!impact) return c.json({ error: "not_found" }, 404);
		const { results } = await env.DB.prepare(
			`SELECT ${PATH} AS repo, r.state, (SELECT fo.handle || '/' || f.slug FROM repos f JOIN owners fo ON fo.id = f.owner_id WHERE f.id = r.forked_from) AS forked_from, x.detail, x.found_at, x.resolved_at
			 FROM impact_repos x JOIN repos r ON r.id = x.repo_id JOIN owners o ON o.id = r.owner_id WHERE x.impact_id = ? ORDER BY x.resolved_at IS NOT NULL, repo`,
		)
			.bind(impact.id)
			.all();
		return c.json({ ...impact, repos: results });
	})
	.post("/impacts/:id/recheck", async (c) => {
		const impact = await env.DB.prepare("SELECT * FROM impacts WHERE id = ? AND closed_at IS NULL").bind(c.req.param("id")).first<ImpactRow>();
		return impact ? c.json(await syncImpact(impact)) : c.json({ error: "not_found" }, 404);
	})
	.post("/impacts/:id/close", async (c) => {
		await env.DB.prepare("UPDATE impacts SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND closed_at IS NULL").bind(c.req.param("id")).run();
		return c.json({ ok: true });
	});

/** #69: open impacts on repos the signed-in user owns (directly or through an org). Mounted under /api/me. */
export const myImpactRoutes = new Hono<Ctx>().get("/impacts", requireRole(), async (c) => {
	const session = c.get("session")!;
	const self = await new OwnerStore(env.DB).forUser(session.user);
	const ownerIds = [self.id, ...session.orgIds];
	const { results } = await env.DB.prepare(
		`SELECT i.id, i.kind, i.target, i.affected, i.title, i.guidance, i.created_at, ${PATH} AS repo, x.detail
		 FROM impact_repos x JOIN impacts i ON i.id = x.impact_id JOIN repos r ON r.id = x.repo_id JOIN owners o ON o.id = r.owner_id
		 WHERE x.resolved_at IS NULL AND i.closed_at IS NULL AND r.state != 'removed' AND r.owner_id IN (${ownerIds.map(() => "?").join(",")})
		 ORDER BY i.created_at DESC LIMIT 200`,
	)
		.bind(...ownerIds)
		.all<{ id: string; kind: string; target: string; affected: string | null; title: string; guidance: string; created_at: string; repo: string; detail: string | null }>();
	// One notice per impact, listing the user's affected repos.
	const byImpact = new Map<string, { id: string; kind: string; target: string; affected: string | null; title: string; guidance: string; createdAt: string; repos: { repo: string; detail: string | null }[] }>();
	for (const r of results) {
		const n = byImpact.get(r.id) ?? { id: r.id, kind: r.kind, target: r.target, affected: r.affected, title: r.title, guidance: r.guidance, createdAt: r.created_at, repos: [] };
		n.repos.push({ repo: r.repo, detail: r.detail });
		byImpact.set(r.id, n);
	}
	return c.json({ items: [...byImpact.values()] });
});
