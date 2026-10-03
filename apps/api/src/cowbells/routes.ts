import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { RepoStore } from "../repos/repository.ts";
import { CowbellStore } from "./store.ts";

type Ctx = { Variables: AuthVariables };
const repos = () => new RepoStore(env.DB);
const cowbells = () => new CowbellStore(env.DB);

/** Only public repos can be rung. */
async function publicRepo(owner: string, slug: string) {
	const repo = await repos().findByPath(owner, slug);
	return repo?.state === "published" ? repo : null;
}

/** Cowbell status and toggles for one repo. Mounted under /api/repos. */
export const repoCowbellRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/cowbell", async (c) => {
		const repo = await publicRepo(c.req.param("owner"), c.req.param("slug"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		return c.json(await cowbells().status(c.get("session")?.user.id ?? null, repo.id));
	})
	.put("/:owner/:slug/cowbell", requireRole(), async (c) => {
		const repo = await publicRepo(c.req.param("owner"), c.req.param("slug"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		const status = await cowbells().set(c.get("session")!.user.id, repo.id, true);
		logEvent("cowbell.rung", { repo: repo.fullName, count: status.count });
		return c.json(status);
	})
	.delete("/:owner/:slug/cowbell", requireRole(), async (c) => {
		const repo = await publicRepo(c.req.param("owner"), c.req.param("slug"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		const status = await cowbells().set(c.get("session")!.user.id, repo.id, false);
		logEvent("cowbell.removed", { repo: repo.fullName, count: status.count });
		return c.json(status);
	});

/** The signed-in user's cowbelled repos. Mounted under /api/cowbells. */
export const cowbellRoutes = new Hono<Ctx>().use(requireRole()).get("/", async (c) => {
	const ids = await cowbells().repoIdsFor(c.get("session")!.user.id);
	return c.json({ items: await repos().findByIds(ids) });
});
