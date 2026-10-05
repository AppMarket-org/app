import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-plane-"));
const { callPlaneTool, describeBoard } = await import("./plane-tools.ts");
const { ApiError } = await import("../api.ts");

const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
function repo(session = true): string {
	const root = mkdtempSync(join(tmpdir(), "am-plane-repo-"));
	const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "agent/dark-mode");
	git("config", "appmarket.repo", "dev/app");
	if (session) git("config", "appmarket.session", SESSION);
	return root;
}

const board = {
	tasks: [
		{ id: "t1", title: "Dark mode", description: "", capabilities: ["typescript"], status: "open", claimedBy: null, branch: null },
		{ id: "t2", title: "Docs", description: "", capabilities: [], status: "claimed", claimedBy: "other", branch: null },
	],
	agents: [
		{ id: SESSION, name: "Claude Code", vendor: "anthropic", capabilities: ["typescript"] },
		{ id: "other", name: "Codex", vendor: "openai", capabilities: [] },
	],
	leases: [{ agentId: "other", taskId: "t2", path: "README.md", expiresAt: Date.UTC(2026, 9, 5, 12) }],
};

function fake(response: unknown = board) {
	const calls: { path: string; method?: string; body?: unknown }[] = [];
	return {
		calls,
		deps: {
			token: async () => "device-token",
			call: (async (_api: string, path: string, init: { method?: string; body?: unknown } = {}) => {
				calls.push({ path, method: init.method, body: init.body });
				if (response instanceof Error) throw response;
				return response;
			}) as never,
		},
	};
}

describe("plane MCP tools (#237)", () => {
	it("needs an agent session in an appmarket repo", async () => {
		const r = await callPlaneTool("plane_board", {}, repo(false), fake().deps);
		expect(r.isError).toBe(true);
		expect(r.content[0]!.text).toMatch(/appmarket session start/);
	});

	it("shows the board with the agent's own entries and names instead of ids", () => {
		const out = JSON.parse(describeBoard(board as never, SESSION));
		expect(out.you).toBe("joined");
		expect(out.open).toEqual([{ id: "t1", title: "Dark mode", needs: ["typescript"] }]);
		expect(out.inProgress).toEqual([{ id: "t2", title: "Docs", by: "Codex" }]);
		expect(out.leases[0]).toMatchObject({ path: "README.md", by: "Codex" });
		expect(out.agents[0].name).toBe("Claude Code (you)");
	});

	it("sends the session as the agent, and the current branch when finishing", async () => {
		const root = repo();
		const f = fake();
		await callPlaneTool("plane_claim", { task: "t1" }, root, f.deps);
		await callPlaneTool("plane_lease", { paths: ["src/"], task: "t1", minutes: 999 }, root, f.deps);
		await callPlaneTool("plane_finish", { task: "t1", note: "Toggle added" }, root, f.deps);
		expect(f.calls).toEqual([
			{ path: "/api/repos/dev/app/plane/tasks/t1/claim", method: "POST", body: { agent: SESSION } },
			{ path: "/api/repos/dev/app/plane/leases", method: "POST", body: { agent: SESSION, paths: ["src/"], task: "t1", seconds: 240 * 60 } },
			{ path: "/api/repos/dev/app/plane/tasks/t1/finish", method: "POST", body: { agent: SESSION, status: "done", branch: "agent/dark-mode", note: "Toggle added" } },
		]);
	});

	it("explains a lease conflict instead of failing silently", async () => {
		const conflict = new ApiError(409, { error: "Another agent holds a lease on these paths.", conflicts: [{ path: "src/" }] });
		const r = await callPlaneTool("plane_lease", { paths: ["src/a.ts"] }, repo(), fake(conflict).deps);
		expect(r).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Held: src\/\. Nothing was leased/) }] });
	});
});
