import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { canEdit, canView } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { bindingUsers, edgesOf, lineage, packageUsers } from "./store.ts";

type Ctx = { Variables: AuthVariables };

/** #67 (G1): one repo's place in the graph. Mounted under /api/repos. */
export const repoGraphRoutes = new Hono<Ctx>().get("/:owner/:slug/graph", async (c) => {
	const store = new RepoStore(env.DB);
	const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
	const session = c.get("session");
	if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
	const [{ ancestors, children, descendants }, edges] = await Promise.all([lineage(repo.id), edgesOf(repo.id)]);
	// Others' private forks are counted, never named; owners and admins see their own.
	const visible = async (r: { id: string; full_name: string; name: string; state: string }) => {
		if (r.state === "published") return true;
		const full = await store.findById(r.id);
		return !!full && canEdit(full, session);
	};
	const shown = [];
	for (const child of children) if (await visible(child)) shown.push({ fullName: child.full_name, name: child.name, state: child.state });
	const shownAncestors = [];
	for (const a of ancestors) if (await visible(a)) shownAncestors.push({ fullName: a.full_name, name: a.name, state: a.state });
	return c.json({
		ancestors: shownAncestors,
		children: shown,
		otherForks: children.length - shown.length,
		descendants,
		dependencies: edges.filter((e) => e.kind !== "binding").map((e) => ({ name: e.target, range: e.detail, dev: e.kind === "dev-dependency" })),
		bindings: edges.filter((e) => e.kind === "binding").map((e) => ({ type: e.target, name: e.detail })),
	});
});

/** #67: marketplace-wide queries for admins (impact analysis, #69). Mounted under /api/admin. */
export const adminGraphRoutes = new Hono<Ctx>()
	.use(requireRole("admin"))
	.get("/graph/packages", async (c) => {
		const name = c.req.query("name")?.trim();
		if (!name) return c.json({ error: "invalid", message: "Pass ?name=<package>." }, 400);
		return c.json({ items: await packageUsers(name, c.req.query("version")?.trim() || undefined) });
	})
	.get("/graph/bindings", async (c) => {
		const type = c.req.query("type")?.trim();
		if (!type) return c.json({ error: "invalid", message: "Pass ?type=<binding type>, e.g. d1." }, 400);
		return c.json({ items: await bindingUsers(type) });
	});
