import { redactSecrets, type Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { canEdit, canView } from "../repos/access.ts";
import { logEvent } from "../observability/log.ts";
import { nextNumber } from "../repos/numbers.ts";
import { RepoStore } from "../repos/repository.ts";
import { agentCard, dispatch } from "./a2a.ts";
import { sessionFork, startMerge } from "./merge.ts";
import { tellBoard } from "./merge-workflow.ts";
import { insertPull, pullSettings } from "../pulls/store.ts";
import { listBranches } from "../artifacts/git.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import type { PlaneResult, RepoPlane } from "./coordinator.ts";
import { cleanTags, type LeaseHint, leaseHints, normalizePath, type PlaneLease, type PlaneTask } from "./model.ts";
import { expandPaths, indexInfo, neighbours } from "../codegraph/store.ts";

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
		// #296: a task is an issue (type Task, assigned to Agents), numbered with the repo's issues.
		const id = crypto.randomUUID();
		const description = text(body.description, 4000);
		const number = await nextNumber(env.DB, p.repo.id);
		await env.DB.prepare("INSERT INTO issues (id, repo_id, number, title, body, type, priority, for_agents, author_id) VALUES (?, ?, ?, ?, ?, 'task', 'none', 1, ?)")
			.bind(id, p.repo.id, number, redactSecrets(title).text, redactSecrets(description).text, c.get("session")!.user.id)
			.run();
		return reply(c, await p.stub.createTask({ id, title, description, capabilities: cleanTags(body.capabilities), issue: { number, type: "task", priority: "none" } }));
	})
	.delete("/:owner/:slug/plane/tasks/:id", async (c) => {
		const p = await plane(c);
		if (!p || c.get("session")!.deviceScopes) return c.json({ error: "not_found" }, 404);
		// #296: cancelling the task closes its issue as not planned.
		await env.DB.prepare(
			"UPDATE issues SET state = 'closed', reason = 'not_planned', closed_by = ?, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND repo_id = ? AND state = 'open'",
		)
			.bind(c.get("session")!.user.id, c.req.param("id"), p.repo.id)
			.run();
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
			const fork = await sessionFork(s.id);
			const task = result.value.tasks.find((t) => t.id === c.req.param("id"));
			if (fork && task) {
				// #260: with review on, the work waits in a pull request for the owner; otherwise it merges.
				const next = (await pullSettings(p.repo.id)).reviewAgentWork
					? openTaskPull(p.repo, task, fork, branch, c.get("session")!.user.id, text(body.note, 2000))
					: startMerge({ repo: p.repo, sourceRepoId: fork, branch, taskId: task.id, sessionId: s.id });
				await next.catch((error: unknown) => logEvent("plane.merge_start_failed", { repo: p.repo.fullName, error: String(error) }, "error"));
			}
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
		const fork = await sessionFork(task.claimedBy);
		if (!fork) return c.json({ error: "The agent session's fork is gone." }, 409);
		await startMerge({ repo: p.repo, sourceRepoId: fork, branch: task.branch, taskId: task.id, sessionId: task.claimedBy });
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
		const result = await p.stub.lease(s.id, paths as string[], typeof body.task === "string" ? body.task : null, seconds);
		if (!result.ok) return reply(c, result);
		// #240: files these import, or that import them, inside other agents' leases (never blocks).
		const hints = await hintsFor(p.repo.id, paths as string[], result.value.leases, s.id).catch(() => []);
		return c.json({ ...result.value, hints });
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

async function hintsFor(repoId: string, paths: string[], leases: PlaneLease[], agentId: string): Promise<LeaseHint[]> {
	if (!(await indexInfo(repoId))) return [];
	const files = (await expandPaths(repoId, paths)).slice(0, 200);
	return files.length ? leaseHints(await neighbours(repoId, files), leases, agentId, Date.now()) : [];
}

/** #260: a pull request for a finished task, from the agent session's fork, linked to the task. */
async function openTaskPull(repo: Repo, task: PlaneTask, forkId: string, branch: string, authorId: string, note: string): Promise<void> {
	const fork = await env.DB.prepare("SELECT git_repo FROM repos WHERE id = ?").bind(forkId).first<{ git_repo: string | null }>();
	const head = fork?.git_repo ? (await listBranches(fork.git_repo)).branches.find((b) => b.name === branch) : undefined;
	if (!head) {
		await tellBoard(repo.id, task.id, { id: task.id, status: "failed", sha: null, error: `${branch} is not in the session's fork. Push it to the appmarket-session remote first.` });
		return;
	}
	const targets = await listBranches(repo.gitRepo!);
	const base = pickBranch(targets.defaultBranch, targets.branches);
	const body = [task.issue ? `Closes #${task.issue.number}` : "", note, task.description, "Opened by the Agents board for this task; merging it completes the task."].filter(Boolean).join("\n\n");
	const pull = await insertPull({ repoId: repo.id, title: task.title, body, authorId, sourceRepoId: forkId, sourceBranch: branch, targetBranch: base?.name ?? targets.defaultBranch, headSha: head.sha, taskId: task.id });
	await tellBoard(repo.id, task.id, { id: pull.id, status: "review", sha: head.sha, error: null, pull: pull.number });
	logEvent("plane.pull_opened", { repo: repo.fullName, number: pull.number, task: task.id });
}

/** The agent session ended or was discarded: it leaves the board (its claims reopen). */
export async function leavePlane(repoId: string, sessionId: string): Promise<void> {
	await stubFor(repoId).removeAgent(sessionId);
}
