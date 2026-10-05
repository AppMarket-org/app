import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import type { PlaneResult, RepoPlane } from "./coordinator.ts";
import { cleanTags, normalizePath } from "./model.ts";

type Ctx = { Variables: AuthVariables };

const stubFor = (repoId: string) => env.PLANE.get(env.PLANE.idFromName(repoId)) as unknown as DurableObjectStub<RepoPlane>;

/** The coordinator of a repo the caller may edit (owners, org members, admins), or null. */
async function plane(c: Context<Ctx>) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo || !canEdit(repo, c.get("session"))) return null;
	return { repo, stub: stubFor(repo.id) };
}

/** The agent is an active agent session (#29) of this repo, started by the caller. */
async function agentSession(repoId: string, userId: string, id: unknown): Promise<{ id: string; harness: string } | null> {
	if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return null;
	return env.DB.prepare("SELECT id, harness FROM agent_sessions WHERE id = ? AND repo_id = ? AND user_id = ? AND status = 'active'")
		.bind(id, repoId, userId)
		.first<{ id: string; harness: string }>();
}

function reply(c: Context<Ctx>, result: PlaneResult) {
	return result.ok ? c.json(result.value) : c.json({ error: result.error, conflicts: result.conflicts ?? [] }, result.conflicts ? 409 : 400);
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * #80/#236: the collaboration plane. Owners post tasks and watch the board; their agents (each an
 * agent session in its own fork) register with an Agent Card, claim tasks and lease paths.
 * Mounted under /api/repos.
 */
export const planeRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/plane", async (c) => {
		const p = await plane(c);
		return p ? c.json(await p.stub.state()) : c.json({ error: "not_found" }, 404);
	})
	// Live board for dashboards (browser sessions only; agents poll or use MCP).
	.get("/:owner/:slug/plane/live", async (c) => {
		const p = await plane(c);
		if (!p || c.get("session")!.deviceScopes) return c.json({ error: "not_found" }, 404);
		if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "expected_websocket" }, 426);
		return p.stub.fetch(c.req.raw);
	})
	.post("/:owner/:slug/plane/tasks", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const title = text(body.title, 200);
		if (!title) return c.json({ error: "title_required" }, 400);
		if ((await p.stub.state()).tasks.filter((t) => t.status === "open" || t.status === "claimed").length >= 200) return c.json({ error: "too_many_tasks" }, 429);
		return reply(c, await p.stub.createTask({ id: crypto.randomUUID(), title, description: text(body.description, 4000), capabilities: cleanTags(body.capabilities) }));
	})
	.delete("/:owner/:slug/plane/tasks/:id", async (c) => {
		const p = await plane(c);
		if (!p || c.get("session")!.deviceScopes) return c.json({ error: "not_found" }, 404);
		return reply(c, await p.stub.deleteTask(c.req.param("id")));
	})
	// Agent Card: the agent session joins the board with its name and capabilities.
	.post("/:owner/:slug/plane/agents", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const s = await agentSession(p.repo.id, c.get("session")!.user.id, body.agent);
		if (!s) return c.json({ error: "agent_session_required" }, 403);
		return reply(c, await p.stub.registerAgent({ id: s.id, name: text(body.name, 80) || s.harness, vendor: text(body.vendor, 80) || s.harness, capabilities: cleanTags(body.capabilities) }));
	})
	.post("/:owner/:slug/plane/tasks/:id/claim", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const s = await agentSession(p.repo.id, c.get("session")!.user.id, body.agent);
		if (!s) return c.json({ error: "agent_session_required" }, 403);
		return reply(c, await p.stub.claim(c.req.param("id"), s.id));
	})
	.post("/:owner/:slug/plane/tasks/:id/finish", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const s = await agentSession(p.repo.id, c.get("session")!.user.id, body.agent);
		if (!s) return c.json({ error: "agent_session_required" }, 403);
		const status = body.status === "failed" ? "failed" : "done";
		const branch = text(body.branch, 200);
		if (branch && !/^[A-Za-z0-9._/-]+$/.test(branch)) return c.json({ error: "invalid_branch" }, 400);
		return reply(c, await p.stub.finish(c.req.param("id"), s.id, status, branch || null, text(body.note, 2000) || null));
	})
	.post("/:owner/:slug/plane/leases", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const s = await agentSession(p.repo.id, c.get("session")!.user.id, body.agent);
		if (!s) return c.json({ error: "agent_session_required" }, 403);
		const raw = Array.isArray(body.paths) ? body.paths.slice(0, 100) : [];
		const paths = raw.map((x) => (typeof x === "string" ? normalizePath(x) : null));
		if (!paths.length || paths.some((x) => x === null)) return c.json({ error: "invalid_paths" }, 400);
		const seconds = typeof body.seconds === "number" ? body.seconds : undefined;
		return reply(c, await p.stub.lease(s.id, paths as string[], typeof body.task === "string" ? body.task : null, seconds));
	})
	.delete("/:owner/:slug/plane/leases", async (c) => {
		const p = await plane(c);
		if (!p) return c.json({ error: "not_found" }, 404);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const s = await agentSession(p.repo.id, c.get("session")!.user.id, body.agent);
		if (!s) return c.json({ error: "agent_session_required" }, 403);
		const paths = Array.isArray(body.paths) ? body.paths.map((x) => (typeof x === "string" ? normalizePath(x) : null)).filter((x): x is string => !!x) : undefined;
		return reply(c, await p.stub.release(s.id, paths));
	});

/** The agent session ended or was discarded: it leaves the board (its claims reopen). */
export async function leavePlane(repoId: string, sessionId: string): Promise<void> {
	await stubFor(repoId).removeAgent(sessionId);
}
