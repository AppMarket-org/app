import type { PlaneAgent, PlaneTask } from "./model.ts";

/**
 * #239: the collaboration plane over A2A (agent-to-agent protocol). Each repo's board is an A2A
 * agent: another vendor's agent (or an orchestrator) sends it work with SendMessage, which posts a
 * task, and follows it with GetTask / ListTasks until an agent on the board has finished it and
 * the merge (#238) landed. Speaks A2A 1.0 (PascalCase methods, TASK_STATE_* values) and the 0.3
 * method names (message/send, tasks/get, ...) with 0.3-shaped results, so older clients work too.
 */
export const A2A_VERSION = "1.0";

type Dialect = "1.0" | "0.3";

const METHODS: Record<string, { op: "send" | "get" | "list" | "cancel"; dialect: Dialect }> = {
	SendMessage: { op: "send", dialect: "1.0" },
	GetTask: { op: "get", dialect: "1.0" },
	ListTasks: { op: "list", dialect: "1.0" },
	CancelTask: { op: "cancel", dialect: "1.0" },
	"message/send": { op: "send", dialect: "0.3" },
	"tasks/get": { op: "get", dialect: "0.3" },
	"tasks/list": { op: "list", dialect: "0.3" },
	"tasks/cancel": { op: "cancel", dialect: "0.3" },
};

export const A2A_ERRORS = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
	taskNotFound: -32001,
	taskNotCancelable: -32002,
	unsupportedOperation: -32004,
} as const;

export interface Board {
	tasks: PlaneTask[];
	agents: PlaneAgent[];
}

/** What dispatch needs from the board; the routes supply the coordinator. */
export interface BoardOps {
	state(): Promise<Board>;
	create(input: { title: string; description: string; capabilities: string[] }): Promise<Board>;
	remove(id: string): Promise<void>;
	canWrite: boolean;
}

type State = "submitted" | "working" | "completed" | "failed" | "canceled";

/** Board task → A2A state and a one-line status message. */
export function taskState(task: PlaneTask, agents: PlaneAgent[]): { state: State; message: string } {
	const by = agents.find((a) => a.id === task.claimedBy)?.name ?? "an agent";
	if (task.status === "open") return { state: "submitted", message: "Waiting for an agent to claim it." };
	if (task.status === "claimed") return { state: "working", message: `${by} is working on it.` };
	if (task.status === "failed") return { state: "failed", message: task.note ? `${by} could not finish it: ${task.note}` : `${by} could not finish it.` };
	const merge = task.merge;
	if (!merge) return { state: "completed", message: `Done by ${by}.` };
	if (merge.status === "merged") return { state: "completed", message: `Done by ${by} and merged${merge.sha ? ` as ${merge.sha.slice(0, 12)}` : ""}.` };
	if (merge.status === "conflict" || merge.status === "failed") return { state: "failed", message: `Done by ${by}, but not merged: ${merge.error ?? merge.status}` };
	if (merge.status === "review") return { state: "working", message: `Done by ${by}; waiting for review in pull request #${merge.pull}.` };
	return { state: "working", message: `Done by ${by}; merging (${merge.status}).` };
}

const STATE_1_0: Record<State, string> = {
	submitted: "TASK_STATE_SUBMITTED",
	working: "TASK_STATE_WORKING",
	completed: "TASK_STATE_COMPLETED",
	failed: "TASK_STATE_FAILED",
	canceled: "TASK_STATE_CANCELED",
};

export function toA2ATask(task: PlaneTask, agents: PlaneAgent[], contextId: string, dialect: Dialect, override?: State): Record<string, unknown> {
	const { state, message } = taskState(task, agents);
	const s = override ?? state;
	const v1 = dialect === "1.0";
	const part = (text: string) => (v1 ? { text } : { kind: "text", text });
	const msg = (role: "user" | "agent", id: string, text: string) => ({
		...(v1 ? {} : { kind: "message" }),
		messageId: id,
		contextId,
		taskId: task.id,
		role: v1 ? (role === "user" ? "ROLE_USER" : "ROLE_AGENT") : role,
		parts: [part(text)],
	});
	const result: Record<string, unknown> = { task: task.title };
	if (task.branch) result.branch = task.branch;
	if (task.merge?.status === "merged" && task.merge.sha) result.commit = task.merge.sha;
	if (task.merge?.pull) result.pull = task.merge.pull;
	const artifacts =
		task.status === "done"
			? [
					{
						artifactId: `${task.id}-result`,
						name: "result",
						parts: [...(task.note ? [part(task.note)] : []), v1 ? { data: result } : { kind: "data", data: result }],
					},
				]
			: [];
	return {
		...(v1 ? {} : { kind: "task" }),
		id: task.id,
		contextId,
		status: { state: v1 ? STATE_1_0[s] : s, message: msg("agent", `${task.id}-status`, override === "canceled" ? "Canceled." : message), timestamp: task.updatedAt },
		...(artifacts.length ? { artifacts } : {}),
		history: [msg("user", `${task.id}-request`, task.description ? `${task.title}\n\n${task.description}` : task.title)],
		// #297: the issue the task is (contextId is the repo's owner/name).
		metadata: { capabilities: task.capabilities, ...(task.issue ? { issue: { ...task.issue, path: `/${contextId}/issues/${task.issue.number}` } } : {}) },
	};
}

/** First line is the title, the rest the details; capabilities from metadata.capabilities. */
export function taskFromMessage(message: unknown): { title: string; description: string; capabilities: string[] } | null {
	const m = message as { parts?: unknown; metadata?: { capabilities?: unknown } } | null;
	if (!m || !Array.isArray(m.parts)) return null;
	const text = m.parts
		.map((p) => (p && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
		.join("\n")
		.trim();
	if (!text) return null;
	const [first, ...rest] = text.split("\n");
	const caps = Array.isArray(m.metadata?.capabilities) ? m.metadata.capabilities.filter((c): c is string => typeof c === "string") : [];
	return { title: first!.trim().slice(0, 200), description: rest.join("\n").trim().slice(0, 4000), capabilities: caps };
}

interface RpcRequest {
	jsonrpc?: unknown;
	id?: unknown;
	method?: unknown;
	params?: unknown;
}

export async function dispatch(request: RpcRequest, ops: BoardOps, contextId: string): Promise<Record<string, unknown>> {
	const id = typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
	const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
	const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
	if (request.jsonrpc !== "2.0" || typeof request.method !== "string") return err(A2A_ERRORS.invalidRequest, "Not a JSON-RPC 2.0 request.");
	const method = METHODS[request.method];
	if (!method) {
		const streaming = request.method === "SendStreamingMessage" || request.method === "message/stream" || request.method === "SubscribeToTask" || request.method === "tasks/resubscribe";
		return streaming ? err(A2A_ERRORS.unsupportedOperation, "Streaming is not supported; poll GetTask.") : err(A2A_ERRORS.methodNotFound, `Unknown method ${request.method}.`);
	}
	const params = (request.params ?? {}) as Record<string, unknown>;
	const { dialect } = method;
	const find = (board: Board, taskId: unknown) => (typeof taskId === "string" ? board.tasks.find((t) => t.id === taskId) : undefined);

	switch (method.op) {
		case "send": {
			if (!ops.canWrite) return err(A2A_ERRORS.unsupportedOperation, "Only the repo's owners and members can send work to its board.");
			const message = params.message as { taskId?: unknown } | undefined;
			if (message?.taskId) return err(A2A_ERRORS.unsupportedOperation, "Tasks do not take follow-up messages; send a new task.");
			const input = taskFromMessage(message);
			if (!input) return err(A2A_ERRORS.invalidParams, "The message needs a text part: the first line is the task's title.");
			const board = await ops.create(input);
			const created = board.tasks.find((t) => t.title === input.title && t.status === "open");
			if (!created) return err(A2A_ERRORS.internal, "The task was not created.");
			const task = toA2ATask(created, board.agents, contextId, dialect);
			return ok(dialect === "1.0" ? { task } : task);
		}
		case "get": {
			const board = await ops.state();
			const task = find(board, params.id);
			return task ? ok(toA2ATask(task, board.agents, contextId, dialect)) : err(A2A_ERRORS.taskNotFound, "No such task.");
		}
		case "list": {
			const board = await ops.state();
			const size = Math.min(Math.max(Number(params.pageSize) || 50, 1), 100);
			const tasks = board.tasks.slice(0, size).map((t) => toA2ATask(t, board.agents, contextId, dialect));
			return ok(dialect === "1.0" ? { tasks, nextPageToken: "", pageSize: size, totalSize: board.tasks.length } : tasks);
		}
		case "cancel": {
			if (!ops.canWrite) return err(A2A_ERRORS.unsupportedOperation, "Only the repo's owners and members can cancel tasks.");
			const board = await ops.state();
			const task = find(board, params.id);
			if (!task) return err(A2A_ERRORS.taskNotFound, "No such task.");
			if (task.status !== "open" && task.status !== "claimed") return err(A2A_ERRORS.taskNotCancelable, `The task is ${task.status}.`);
			await ops.remove(task.id);
			return ok(toA2ATask(task, board.agents, contextId, dialect, "canceled"));
		}
	}
}

/** The repo's Agent Card (A2A 1.0, with the 0.3 top-level fields older clients read). */
export function agentCard(repo: { fullName: string; name: string }, endpoint: string, origin: string): Record<string, unknown> {
	return {
		name: `${repo.name} task board`,
		description: `The collaboration board of ${repo.fullName} on appmarket.org. Send a task as a message (first line: title; the rest: details; metadata.capabilities: the skills it needs). Agents on the board claim it, work in their own branches, and appmarket.org merges the result after checks. Follow it with GetTask.`,
		supportedInterfaces: [{ url: endpoint, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION }],
		provider: { organization: "appmarket.org", url: origin },
		version: "1.0.0",
		documentationUrl: `${origin}/${repo.fullName}`,
		capabilities: { streaming: false, pushNotifications: false },
		securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: "This repo's A2A key (an owner creates one in the repo's Settings), or an appmarket.org device token of an owner or member." } } },
		securityRequirements: [{ schemes: { bearer: { list: [] } } }],
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain", "application/json"],
		skills: [
			{
				id: "post-task",
				name: "Post a task",
				description: "Adds a task to the board for the agents working on this repo; completes when an agent's branch is merged.",
				tags: ["code", "tasks", "git"],
				examples: ["Add a /health endpoint that returns { ok: true }"],
			},
		],
		// A2A 0.3 clients read these.
		protocolVersion: "0.3.0",
		url: endpoint,
		preferredTransport: "JSONRPC",
		security: [{ bearer: [] }],
	};
}
