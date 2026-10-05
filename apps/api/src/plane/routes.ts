import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { canEdit, canView } from "../repos/access.ts";
import { logEvent } from "../observability/log.ts";
import { RepoStore } from "../repos/repository.ts";
import { agentCard, dispatch } from "./a2a.ts";
import { startMerge } from "./merge.ts";
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
		const result = await p.stub.finish(c.req.param("id"), s.id, status, branch || null, text(body.note, 2000) || null);
		// #238: a finished task with a branch is merged (rebase, checks, conformance, fast-forward).
		if (result.ok && status === "done" && branch) {
			await startMerge(p.repo, c.req.param("id"), s.id, branch).catch((error: unknown) => logEvent("plane.merge_start_failed", { repo: p.repo.fullName, error: String(error) }, "error"));
			return c.json(await p.stub.state());
		}
		return reply(c, result);
	})
	// #238: merge again (after a conflict was resolved, the base moved, or checks were fixed). Owners only.
	.post("/:owner/:slug/plane/tasks/:id/merge", async (c) => {
		const p = await plane(c);
		if (!p || c.get("session")!.deviceScopes) return c.json({ error: "not_found" }, 404);
		const task = (await p.stub.state()).tasks.find((t) => t.id === c.req.param("id"));
		if (!task || task.status !== "done" || !task.branch || !task.claimedBy) return c.json({ error: "Only finished tasks with a branch can be merged." }, 400);
		if (task.merge?.status === "merged") return c.json({ error: "Already merged." }, 409);
		await startMerge(p.repo, task.id, task.claimedBy, task.branch);
		return c.json(await p.stub.state());
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

/**
 * #239: the board as an A2A agent. The Agent Card is public for published repos (so other agents
 * can find the board); the JSON-RPC endpoint is for the repo's owners and members (their device
 * token or browser session). Mounted under /api/repos.
 */
export const a2aRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/a2a", (c) => card(c))
	.get("/:owner/:slug/.well-known/agent-card.json", (c) => card(c))
	.post("/:owner/:slug/a2a", async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
		const session = c.get("session");
		if (!session) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Sign in: send an appmarket.org device token as a Bearer token." } }, 401, { "WWW-Authenticate": "Bearer" });
		if (!repo || !canEdit(repo, session)) return c.json({ error: "not_found" }, 404);
		const request = await c.req.json<Record<string, unknown>>().catch(() => null);
		if (!request || Array.isArray(request)) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Send one JSON-RPC request object." } }, 400);
		const stub = stubFor(repo.id);
		const response = await dispatch(
			request,
			{
				canWrite: true,
				state: () => stub.state(),
				create: async (input) => {
					const result = await stub.createTask({ id: crypto.randomUUID(), title: input.title, description: input.description, capabilities: cleanTags(input.capabilities) });
					if (!result.ok) throw new Error(result.error);
					return result.value;
				},
				remove: async (id) => void (await stub.deleteTask(id)),
			},
			repo.fullName,
		);
		c.header("A2A-Version", "1.0");
		return c.json(response);
	});

async function card(c: Context<Ctx>) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo || repo.state === "removed" || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
	const endpoint = `${env.PUBLIC_ORIGIN}/api/repos/${repo.fullName}/a2a`;
	c.header("Cache-Control", repo.state === "published" ? "public, max-age=300" : "private, no-store");
	return c.json(agentCard({ fullName: repo.fullName, name: repo.name }, endpoint, env.PUBLIC_ORIGIN));
}

/** The agent session ended or was discarded: it leaves the board (its claims reopen). */
export async function leavePlane(repoId: string, sessionId: string): Promise<void> {
	await stubFor(repoId).removeAgent(sessionId);
}
