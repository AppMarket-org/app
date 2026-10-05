import { MEMORY_LIMITS, parseMemoryInput } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { type Actor, createNote, deleteNote, getNote, listNotes, noteHistory, updateNote } from "./store.ts";

type Ctx = { Variables: AuthVariables };

/** Owners, org members and admins; never public. */
async function repoFor(c: Context<Ctx>) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo || repo.state === "removed" || !canEdit(repo, c.get("session"))) return null;
	c.header("Cache-Control", "private, no-store");
	return repo;
}

/** Writes per user (approximate is fine): agents can write in bursts, not floods. */
async function limited(c: Context<Ctx>): Promise<Response | null> {
	const { success } = await env.RL_MEMORY.limit({ key: c.get("session")!.user.id });
	return success ? null : c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
}

const body = (c: Context<Ctx>) => c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
const notFound = (c: Context<Ctx>) => c.json({ error: "not_found" }, 404);

/**
 * #194 (Agent memory): a repo's notes for its agents and people. Mounted under /api/repos.
 * Device tokens need memory:read / memory:write (see auth/scopes.ts).
 */
export const memoryRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/memory", async (c) => {
		const repo = await repoFor(c);
		if (!repo) return notFound(c);
		const q = c.req.query("q")?.slice(0, 200);
		const tag = c.req.query("tag")?.slice(0, 32);
		const limit = Number(c.req.query("limit")) || undefined;
		const result = await listNotes(repo.id, { q, tag, limit, pinnedOnly: c.req.query("pinned") === "true" });
		return c.json({ ...result, limits: MEMORY_LIMITS });
	})
	.post("/:owner/:slug/memory", async (c) => {
		const repo = await repoFor(c);
		if (!repo) return notFound(c);
		const blocked = await limited(c);
		if (blocked) return blocked;
		const input = parseMemoryInput(await body(c), false);
		if ("error" in input) return c.json({ error: "invalid", message: input.error }, 400);
		const actor: Actor = { userId: c.get("session")!.user.id, source: input.source, sessionId: input.sessionId };
		const result = await createNote(repo.id, { text: input.text!, tags: input.tags!, pinned: input.pinned ?? false }, actor);
		if ("error" in result) return c.json({ error: "limit", message: `A repo keeps at most ${MEMORY_LIMITS.notesPerRepo} notes; delete some first.` }, 409);
		logEvent("memory.created", { repo: repo.fullName, source: input.source, redactions: result.note.redactions });
		return c.json(result.note, 201);
	})
	.get("/:owner/:slug/memory/:id", async (c) => {
		const repo = await repoFor(c);
		const note = repo ? await getNote(repo.id, c.req.param("id")) : null;
		return note ? c.json(note) : notFound(c);
	})
	.patch("/:owner/:slug/memory/:id", async (c) => {
		const repo = await repoFor(c);
		if (!repo) return notFound(c);
		const blocked = await limited(c);
		if (blocked) return blocked;
		const input = parseMemoryInput(await body(c), true);
		if ("error" in input) return c.json({ error: "invalid", message: input.error }, 400);
		const note = await updateNote(repo.id, c.req.param("id"), input, { userId: c.get("session")!.user.id, source: input.source, sessionId: input.sessionId });
		return note ? c.json(note) : notFound(c);
	})
	.delete("/:owner/:slug/memory/:id", async (c) => {
		const repo = await repoFor(c);
		if (!repo) return notFound(c);
		const blocked = await limited(c);
		if (blocked) return blocked;
		const source = parseMemoryInput({ text: "x", source: c.req.query("source") }, true);
		const actor: Actor = { userId: c.get("session")!.user.id, source: "error" in source ? "web" : source.source, sessionId: null };
		return (await deleteNote(repo.id, c.req.param("id"), actor)) ? c.json({ ok: true }) : notFound(c);
	})
	.get("/:owner/:slug/memory/:id/history", async (c) => {
		const repo = await repoFor(c);
		const history = repo ? await noteHistory(repo.id, c.req.param("id")) : null;
		return history ? c.json({ items: history }) : notFound(c);
	});
