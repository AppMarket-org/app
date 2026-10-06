import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { canView } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { CowbellStore } from "./store.ts";

type Ctx = { Variables: AuthVariables };
const repos = () => new RepoStore(env.DB);
const cowbells = () => new CowbellStore(env.DB);

type Session = AuthVariables["session"];

/** Anyone who can see a repo can ring it: public repos, and private ones for their owners. */
async function visibleRepo(owner: string, slug: string, session: Session) {
	const repo = await repos().findByPath(owner, slug);
	return repo && repo.state !== "removed" && canView(repo, session) ? repo : null;
}

/** Cowbell status and toggles for one repo. Mounted under /api/repos. */
export const repoCowbellRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/cowbell", async (c) => {
		const repo = await visibleRepo(c.req.param("owner"), c.req.param("slug"), c.get("session"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		return c.json(await cowbells().status(c.get("session")?.user.id ?? null, repo.id));
	})
	.put("/:owner/:slug/cowbell", requireRole(), async (c) => {
		const repo = await visibleRepo(c.req.param("owner"), c.req.param("slug"), c.get("session"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		const status = await cowbells().set(c.get("session")!.user.id, repo.id, true);
		logEvent("cowbell.rung", { repo: repo.fullName, count: status.count });
		return c.json(status);
	})
	.delete("/:owner/:slug/cowbell", requireRole(), async (c) => {
		const repo = await visibleRepo(c.req.param("owner"), c.req.param("slug"), c.get("session"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		const status = await cowbells().set(c.get("session")!.user.id, repo.id, false);
		logEvent("cowbell.removed", { repo: repo.fullName, count: status.count });
		return c.json(status);
	});

/** The repos a user rang that they can still see: one that has since gone private (and is not theirs) drops out. */
export async function cowbelledRepos(session: NonNullable<Session>) {
	const ids = await cowbells().repoIdsFor(session.user.id);
	return (await repos().findByIds(ids)).filter((repo) => canView(repo, session));
}

/** The signed-in user's cowbelled repos. Mounted under /api/cowbells. */
export const cowbellRoutes = new Hono<Ctx>().use(requireRole()).get("/", async (c) => {
	return c.json({ items: await cowbelledRepos(c.get("session")!) });
});
