import { describe, expect, it } from "vitest";
import { A2A_ERRORS, agentCard, type Board, type BoardOps, dispatch, taskFromMessage, taskState, toA2ATask } from "./a2a";
import type { PlaneTask } from "./model";

const task = (o: Partial<PlaneTask> = {}): PlaneTask => ({ id: "t1", title: "Add /health", description: "Return ok", capabilities: ["typescript"], status: "open", claimedBy: null, branch: null, note: null, issue: null, merge: null, createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z", ...o });
const agents = [{ id: "a1", name: "Claude Code", vendor: "anthropic", capabilities: ["typescript"], lastSeen: "" }];

function fakeOps(board: Board, canWrite = true): BoardOps & { created: unknown[]; removed: string[] } {
	const created: unknown[] = [];
	const removed: string[] = [];
	return {
		created,
		removed,
		canWrite,
		state: async () => board,
		create: async (input) => {
			created.push(input);
			board.tasks.unshift(task({ id: "new", ...input }));
			return board;
		},
		remove: async (id) => void removed.push(id),
	};
}

const rpc = (method: string, params: unknown) => ({ jsonrpc: "2.0", id: 7, method, params });

describe("A2A on the board (#239)", () => {
	it("maps board states, including the merge, to A2A states", () => {
		expect(taskState(task(), agents).state).toBe("submitted");
		expect(taskState(task({ status: "claimed", claimedBy: "a1" }), agents)).toEqual({ state: "working", message: "Claude Code is working on it." });
		expect(taskState(task({ status: "done", claimedBy: "a1", merge: { id: "m", status: "checking", sha: null, error: null } }), agents).state).toBe("working");
		// Finished with a branch, before its merge or review pull request exists: still working, never completed.
		expect(taskState(task({ status: "done", claimedBy: "a1", branch: "claude/x", merge: null }), agents)).toEqual({ state: "working", message: "Done by Claude Code; handing claude/x to merge." });
		expect(taskState(task({ status: "done", claimedBy: "a1", branch: null, merge: null }), agents).state).toBe("completed");
		expect(taskState(task({ status: "done", claimedBy: "a1", merge: { id: "m", status: "merged", sha: "a".repeat(40), error: null } }), agents).state).toBe("completed");
		expect(taskState(task({ status: "done", claimedBy: "a1", merge: { id: "m", status: "conflict", sha: null, error: "conflicts in a.ts" } }), agents)).toMatchObject({ state: "failed", message: expect.stringContaining("conflicts in a.ts") });
		expect(taskState(task({ status: "done", claimedBy: "a1", merge: { id: "p", status: "review", sha: null, error: null, pull: 7 } }), agents)).toEqual({ state: "working", message: "Done by Claude Code; waiting for review in pull request #7." });
	});

	it("SendMessage (1.0) posts a task from the text and returns it wrapped", async () => {
		const ops = fakeOps({ tasks: [], agents });
		const r = (await dispatch(rpc("SendMessage", { message: { messageId: "m1", role: "ROLE_USER", parts: [{ text: "Add /health\nReturn { ok: true }" }], metadata: { capabilities: ["typescript"] } } }), ops, "dev/app")) as { result: { task: Record<string, any> } };
		expect(ops.created).toEqual([{ title: "Add /health", description: "Return { ok: true }", capabilities: ["typescript"] }]);
		expect(r.result.task).toMatchObject({ id: "new", contextId: "dev/app", status: { state: "TASK_STATE_SUBMITTED", message: { role: "ROLE_AGENT" } } });
		expect(r.result.task.kind).toBeUndefined();
	});

	it("speaks 0.3 to 0.3 method names: kind fields, lowercase states, the task unwrapped", async () => {
		const merged = task({ status: "done", claimedBy: "a1", branch: "agent/health", note: "Added it", merge: { id: "m", status: "merged", sha: "b".repeat(40), error: null } });
		const r = (await dispatch(rpc("tasks/get", { id: "t1" }), fakeOps({ tasks: [merged], agents }), "dev/app")) as { result: Record<string, any> };
		expect(r.result).toMatchObject({ kind: "task", status: { state: "completed" } });
		expect(r.result.artifacts[0].parts).toEqual([{ kind: "text", text: "Added it" }, { kind: "data", data: { task: "Add /health", branch: "agent/health", commit: "b".repeat(40) } }]);
	});

	it("cancels open or claimed tasks only, and reports unknown ones", async () => {
		const ops = fakeOps({ tasks: [task(), task({ id: "t2", status: "done" })], agents });
		expect(await dispatch(rpc("CancelTask", { id: "t1" }), ops, "c")).toMatchObject({ result: { status: { state: "TASK_STATE_CANCELED" } } });
		expect(ops.removed).toEqual(["t1"]);
		expect(await dispatch(rpc("CancelTask", { id: "t2" }), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.taskNotCancelable } });
		expect(await dispatch(rpc("GetTask", { id: "nope" }), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.taskNotFound } });
	});

	it("carries the task's issue in its metadata (#297)", () => {
		const t = toA2ATask(task({ issue: { number: 7, type: "bug", priority: "high" } }), agents, "dev/app", "1.0");
		expect(t.metadata).toEqual({ capabilities: ["typescript"], issue: { number: 7, type: "bug", priority: "high", path: "/dev/app/issues/7" } });
		expect(toA2ATask(task(), agents, "dev/app", "1.0").metadata).toEqual({ capabilities: ["typescript"] });
	});

	it("refuses what it does not do", async () => {
		const ops = fakeOps({ tasks: [], agents });
		expect(await dispatch(rpc("SendStreamingMessage", {}), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.unsupportedOperation } });
		expect(await dispatch(rpc("Frobnicate", {}), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.methodNotFound } });
		expect(await dispatch({ id: 1, method: "GetTask" }, ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.invalidRequest } });
		expect(await dispatch(rpc("SendMessage", { message: { parts: [{ text: "x" }], taskId: "t1" } }), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.unsupportedOperation } });
		expect(await dispatch(rpc("SendMessage", { message: { parts: [] } }), ops, "c")).toMatchObject({ error: { code: A2A_ERRORS.invalidParams } });
		expect(await dispatch(rpc("SendMessage", { message: { parts: [{ text: "x" }] } }), fakeOps({ tasks: [], agents }, false), "c")).toMatchObject({ error: { code: A2A_ERRORS.unsupportedOperation } });
		expect(taskFromMessage({ parts: [{ text: "  " }] })).toBeNull();
	});

	it("publishes an Agent Card with the JSON-RPC interface and bearer auth", () => {
		const card = agentCard({ fullName: "dev/app", name: "App" }, "https://appmarket.org/api/repos/dev/app/a2a", "https://appmarket.org");
		expect(card).toMatchObject({
			supportedInterfaces: [{ url: "https://appmarket.org/api/repos/dev/app/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
			securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
			skills: [{ id: "post-task" }],
			url: "https://appmarket.org/api/repos/dev/app/a2a",
		});
	});
});
