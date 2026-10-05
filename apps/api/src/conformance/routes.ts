import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { canEdit, canView } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { resultsFor } from "./evaluate.ts";

type Ctx = { Variables: AuthVariables };

/**
 * #68: conformance of the published version (everyone who can see the app) or of the newest
 * pushed commit (?commit=latest, editors). Mounted under /api/repos.
 */
export const conformanceRoutes = new Hono<Ctx>().get("/:owner/:slug/conformance", async (c) => {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
	const session = c.get("session");
	if (!repo?.gitRepo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
	let commit = repo.publishedCommit;
	if (c.req.query("commit") === "latest") {
		if (!canEdit(repo, session)) return c.json({ error: "not_found" }, 404);
		using git = await env.ARTIFACTS.get(repo.gitRepo);
		commit = (await git.log({ limit: 1 }).catch(() => []))[0]?.hash ?? null;
	}
	if (!commit) return c.json({ commit: null, results: [] });
	return c.json(await resultsFor({ id: repo.id, gitRepo: repo.gitRepo, runtime: repo.runtime }, commit));
});
