import { ApiError, call as apiCall } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { SESSION_REMOTE, storedSessions } from "./session.ts";

/**
 * #237: MCP tools for the collaboration plane (#236). An agent in an agent session (#29) joins the
 * repo's board, claims a task, leases the files it will change, and reports the task finished
 * with the branch it pushed (to the repo itself since #309). Same tools in every harness.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const list = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const PLANE_TOOLS = [
	{
		name: "plane_board",
		description: "Show this repo's task board on appmarket.org: open tasks, most urgent first (each is an issue: its number, type and priority, and the capabilities it needs), tasks in progress, the agents taking part and the files they have leased. Read it before claiming a task or editing files another agent may hold; read a task's issue and comments with issue_view.",
		inputSchema: obj({}),
	},
	{
		name: "plane_join",
		description: "Join the task board as an agent (your Agent Card). Call once per session before claiming tasks. Capabilities are short tags such as typescript, frontend, rust, docs; you can only claim tasks whose needs you declared.",
		inputSchema: obj({ name: str("Your name, e.g. Claude Code."), vendor: str("Who makes you, e.g. anthropic."), capabilities: list("What you can do, as short tags.") }, ["name", "capabilities"]),
	},
	{
		name: "plane_claim",
		description: "Claim an open task from the board so no other agent works on it. Then lease the files you will change with plane_lease.",
		inputSchema: obj({ task: str("The task id from plane_board.") }, ["task"]),
	},
	{
		name: "plane_lease",
		description: "Lease the files or directories (ending in /) you are about to change, so other agents leave them alone. All or nothing: if another agent holds any of them you get none, and the answer says who holds what. Leases expire (default 60 minutes); lease again to extend.",
		inputSchema: obj({ paths: list("Repo-relative paths, e.g. src/auth/ or README.md."), task: str("The task the lease is for (released when it finishes)."), minutes: { type: "number", description: "How long, 1 to 240 minutes." } }, ["paths"]),
	},
	{
		name: "plane_release",
		description: "Release leases you no longer need (all of yours when no paths are given).",
		inputSchema: obj({ paths: list("Paths to release; omit for all.") }),
	},
	{
		name: "plane_finish",
		description: `Report a claimed task done or failed. Commit and push your work to the ${SESSION_REMOTE} remote first; the current branch is reported as the branch to merge. The task's leases are released.`,
		inputSchema: obj({ task: str("The task id."), status: { type: "string", enum: ["done", "failed"] }, note: str("What you did, or why it failed.") }, ["task"]),
	},
] as const;

export const PLANE_TOOL_NAMES: ReadonlySet<string> = new Set(PLANE_TOOLS.map((t) => t.name));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

interface Board {
	tasks: { id: string; title: string; description: string; capabilities: string[]; status: string; claimedBy: string | null; branch: string | null; issue?: { number: number; type: string; priority: string } | null }[];
	agents: { id: string; name: string; vendor: string; capabilities: string[] }[];
	leases: { agentId: string; taskId: string | null; path: string; expiresAt: number }[];
	/** #240: soft conflicts through imports, on lease. */
	hints?: { path: string; related: string; relation: string; agentId: string; lease: string }[];
}

export interface PlaneDeps {
	call: typeof apiCall;
	token: (api: string) => Promise<string | null>;
}
const defaults: PlaneDeps = { call: apiCall, token: async (api) => (await loadCredentials(api))?.token ?? null };

const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** The board as an agent reads it: its own entries marked, names instead of ids, open tasks most urgent first. */
export function describeBoard(board: Board, me: string): string {
	const name = (id: string | null) => (id === me ? "you" : (board.agents.find((a) => a.id === id)?.name ?? "an agent that left"));
	// #297: each task is an issue; issue_view reads it with its comments.
	const issue = (t: Board["tasks"][number]) => (t.issue ? { issue: t.issue.number, type: t.issue.type, priority: t.issue.priority === "none" ? undefined : t.issue.priority } : {});
	const rank = (t: Board["tasks"][number]) => RANK[t.issue?.priority ?? "none"] ?? 4;
	const out = {
		you: board.agents.some((a) => a.id === me) ? "joined" : "not joined yet (call plane_join)",
		open: board.tasks
			.filter((t) => t.status === "open")
			.sort((a, b) => rank(a) - rank(b))
			.map((t) => ({ id: t.id, ...issue(t), title: t.title, description: t.description || undefined, needs: t.capabilities })),
		inProgress: board.tasks.filter((t) => t.status === "claimed").map((t) => ({ id: t.id, ...issue(t), title: t.title, by: name(t.claimedBy) })),
		finished: board.tasks.filter((t) => t.status === "done" || t.status === "failed").slice(0, 10).map((t) => ({ id: t.id, title: t.title, status: t.status, by: name(t.claimedBy), branch: t.branch })),
		agents: board.agents.map((a) => ({ name: a.id === me ? `${a.name} (you)` : a.name, vendor: a.vendor, capabilities: a.capabilities })),
		leases: board.leases.map((l) => ({ path: l.path, by: name(l.agentId), until: new Date(l.expiresAt).toISOString() })),
	};
	return JSON.stringify(out, null, 2);
}

function problem(error: unknown): string {
	if (error instanceof ApiError) {
		const body = (error.body ?? {}) as { error?: string; conflicts?: { path: string }[] };
		if (error.status === 401) return "Not signed in to appmarket.org: run `appmarket login`.";
		if (error.status === 403 && body.error === "insufficient_scope") return "This sign-in cannot use the task board; run `appmarket login` again.";
		if (error.status === 403) return "This agent session is not active for this repo; start one with `appmarket session start`.";
		if (error.status === 404) return "No task board for this repo (or no access to it).";
		if (body.conflicts?.length) return `${body.error} Held: ${body.conflicts.map((c) => c.path).join(", ")}. Nothing was leased; pick other files or wait.`;
		if (body.error) return body.error;
	}
	return `appmarket.org could not be reached (${error instanceof Error ? error.message : String(error)}).`;
}

export async function callPlaneTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), deps: PlaneDeps = defaults): Promise<Result> {
	const root = repoRoot(cwd);
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) return text("This folder is not an appmarket.org repo (run `appmarket init`).", true);
	const agent = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root });
	if (!agent) return text("The task board is for agent sessions: run `appmarket session start` in this repo first.", true);
	const api = storedSessions().find((s) => s.id === agent)?.api ?? gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	const token = await deps.token(api);
	if (!token) return text("Not signed in to appmarket.org: run `appmarket login`.", true);
	const base = `/api/repos/${repo}/plane`;
	const send = (path: string, method: string, body: Record<string, unknown>) => deps.call<Board>(api, base + path, { method, token, body: { agent, ...body } });
	const tags = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
	try {
		switch (name) {
			case "plane_board":
				return text(describeBoard(await deps.call<Board>(api, base, { token }), agent));
			case "plane_join": {
				const board = await send("/agents", "POST", { name: args.name, vendor: args.vendor, capabilities: tags(args.capabilities) });
				return text(`Joined as ${board.agents.find((a) => a.id === agent)?.name}. ${board.tasks.filter((t) => t.status === "open").length} open task(s); see plane_board.`);
			}
			case "plane_claim": {
				if (typeof args.task !== "string") return text("task is required.", true);
				const board = await send(`/tasks/${encodeURIComponent(args.task)}/claim`, "POST", {});
				return text(`Claimed "${board.tasks.find((t) => t.id === args.task)?.title}". Lease the files you will change with plane_lease before editing them.`);
			}
			case "plane_lease": {
				const paths = tags(args.paths);
				if (!paths.length) return text("paths is required.", true);
				const minutes = typeof args.minutes === "number" ? Math.min(Math.max(args.minutes, 1), 240) : undefined;
				const board = await send("/leases", "POST", { paths, task: typeof args.task === "string" ? args.task : undefined, seconds: minutes ? minutes * 60 : undefined });
				const mine = board.leases.filter((l) => l.agentId === agent);
				const name = (id: string) => board.agents.find((x) => x.id === id)?.name ?? "another agent";
				const hints = (board.hints ?? []).map((h) => `  ${h.path} ${h.relation} ${h.related}, which ${name(h.agentId)} has leased (${h.lease})`);
				return text(
					`Leased: ${mine.map((l) => `${l.path} (until ${new Date(l.expiresAt).toISOString()})`).join(", ")}.` +
						(hints.length ? `\nHeads-up, related files are held by other agents; coordinate or keep those interfaces stable:\n${hints.join("\n")}` : ""),
				);
			}
			case "plane_release": {
				const paths = tags(args.paths);
				await send("/leases", "DELETE", paths.length ? { paths } : {});
				return text(paths.length ? `Released ${paths.join(", ")}.` : "Released all your leases.");
			}
			case "plane_finish": {
				if (typeof args.task !== "string") return text("task is required.", true);
				const branch = gitOr(["symbolic-ref", "--quiet", "--short", "HEAD"], "", { cwd: root });
				const status = args.status === "failed" ? "failed" : "done";
				await send(`/tasks/${encodeURIComponent(args.task)}/finish`, "POST", { status, branch: branch || undefined, note: typeof args.note === "string" ? args.note : undefined });
				return text(status === "done" ? `Task done; branch ${branch || "(detached)"} reported for merging, leases released.` : "Task marked failed; leases released.");
			}
			default:
				return text(`Unknown tool: ${name}`, true);
		}
	} catch (error) {
		return text(problem(error), true);
	}
}
