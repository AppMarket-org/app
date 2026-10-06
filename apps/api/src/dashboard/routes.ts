import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { cowbelledRepos } from "../cowbells/routes.ts";
import { deploymentsFor } from "../deploy/store.ts";
import { RepoStore } from "../repos/repository.ts";

type Ctx = { Variables: AuthVariables };

/**
 * The dashboard tabs' counts, in one request when the dashboard opens. Each is the length of the
 * list its tab shows, so the badge and the page always agree. Mounted under /api/me.
 */
export const dashboardCountRoutes = new Hono<Ctx>().get("/counts", requireRole(), async (c) => {
	const session = c.get("session")!;
	const [repositories, apps, cowbells] = await Promise.all([
		new RepoStore(env.DB).listByOwners([session.user.id, ...session.orgIds]),
		deploymentsFor(session.user.id),
		cowbelledRepos(session),
	]);
	c.header("Cache-Control", "private, no-store");
	return c.json({ repositories: repositories.length, apps: apps.length, cowbells: cowbells.length });
});
