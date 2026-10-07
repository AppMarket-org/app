import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { normalizePath } from "../plane/model.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { ensureIndex, findSymbols, graphMap, impactOf, references, symbolsIn } from "./store.ts";

type Ctx = { Variables: AuthVariables };

/** The repo (owners, members, admins) with its graph brought up to date with the default branch. */
async function indexed(c: Context<Ctx>) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo?.gitRepo || !canEdit(repo, c.get("session"))) return null;
	const index = await ensureIndex({ id: repo.id, gitRepo: repo.gitRepo });
	c.header("Cache-Control", "private, no-store");
	return { repo, index };
}

const notFound = (c: Context<Ctx>) => c.json({ error: "not_found" }, 404);
const noIndex = (c: Context<Ctx>) => c.json({ error: "empty", message: "The repo has no commits yet." }, 409);

/**
 * #240: the code graph of a repo's default branch for its agents (and the MCP tools of
 * `appmarket mcp`): definitions, importers, and what a change can affect. Mounted under /api/repos.
 */
export const codeGraphRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/code-graph", async (c) => {
		const r = await indexed(c);
		if (!r) return notFound(c);
		return r.index ? c.json(r.index) : noIndex(c);
	})
	.get("/:owner/:slug/code-graph/symbols", async (c) => {
		const q = (c.req.query("q") ?? "").trim();
		if (!/^[A-Za-z_$][\w$]{0,99}$/.test(q)) return c.json({ error: "invalid", message: "q is an identifier (or its start)." }, 400);
		const r = await indexed(c);
		if (!r) return notFound(c);
		if (!r.index) return noIndex(c);
		return c.json({ commit: r.index.commit, symbols: await findSymbols(r.repo.id, q) });
	})
	.get("/:owner/:slug/code-graph/references", async (c) => {
		const path = normalizePath(c.req.query("path") ?? "");
		if (!path || path.endsWith("/")) return c.json({ error: "invalid", message: "path is a file in the repo." }, 400);
		const r = await indexed(c);
		if (!r) return notFound(c);
		if (!r.index) return noIndex(c);
		return c.json({ commit: r.index.commit, path, ...(await references(r.repo.id, path)) });
	})
	.get("/:owner/:slug/code-graph/impact", async (c) => {
		const paths = (c.req.query("paths") ?? "")
			.split(",")
			.map((p) => normalizePath(p))
			.filter((p): p is string => !!p)
			.slice(0, 50);
		if (!paths.length) return c.json({ error: "invalid", message: "paths is a comma-separated list of files or directories/." }, 400);
		const r = await indexed(c);
		if (!r) return notFound(c);
		if (!r.index) return noIndex(c);
		return c.json({ commit: r.index.commit, paths, affected: await impactOf(r.repo.id, paths) });
	})
	// The UI: the whole graph to draw (files, their symbol counts, the imports between them).
	.get("/:owner/:slug/code-graph/map", async (c) => {
		const r = await indexed(c);
		if (!r) return notFound(c);
		if (!r.index) return noIndex(c);
		return c.json({ ...r.index, ...(await graphMap(r.repo.id)) });
	})
	// The UI's panel beside an open file: what it defines, imports and is imported by, and what a change to it can affect.
	.get("/:owner/:slug/code-graph/file", async (c) => {
		const path = normalizePath(c.req.query("path") ?? "");
		if (!path || path.endsWith("/")) return c.json({ error: "invalid", message: "path is a file in the repo." }, 400);
		const r = await indexed(c);
		if (!r) return notFound(c);
		if (!r.index) return noIndex(c);
		const [symbols, refs, impact] = await Promise.all([symbolsIn(r.repo.id, path), references(r.repo.id, path), impactOf(r.repo.id, [path])]);
		return c.json({ commit: r.index.commit, branch: r.index.branch, path, symbols, ...refs, impact });
	});
