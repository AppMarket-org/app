import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-mem-"));
const { ApiError } = await import("../api.ts");
const { callMemoryTool } = await import("./memory-tools.ts");

function checkout(session?: string): string {
	const root = mkdtempSync(join(tmpdir(), "am-mem-repo-"));
	execFileSync("git", ["init", "-q", "-b", "main", root]);
	execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
	if (session) execFileSync("git", ["config", "appmarket.session", session], { cwd: root });
	return root;
}

function fake(routes: Record<string, unknown>) {
	const calls: { path: string; method?: string; body?: unknown }[] = [];
	return {
		calls,
		deps: {
			token: async () => "t",
			call: (async (_api: string, path: string, init: { method?: string; body?: unknown } = {}) => {
				calls.push({ path, method: init.method, body: init.body });
				const hit = routes[`${init.method ?? "GET"} ${path.split("?")[0]}`];
				if (hit instanceof Error) throw hit;
				if (hit === undefined) throw new ApiError(404, { error: "not_found" });
				return hit;
			}) as never,
		},
	};
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("memory MCP tools (#195)", () => {
	it("recalls notes with their ids, pinned first", async () => {
		const f = fake({ "GET /api/repos/dev/app/memory": { notes: [{ id: ID, text: "Run tests with pnpm test", tags: ["testing"], pinned: true, createdBy: "dev", updatedAt: "" }], total: 3 } });
		const r = await callMemoryTool("memory_recall", { query: "tests" }, checkout(), f.deps);
		expect(f.calls[0]!.path).toBe("/api/repos/dev/app/memory?q=tests&limit=20");
		expect(r.content[0]!.text).toBe(`- [${ID}] (pinned) #testing\n  Run tests with pnpm test\n(2 more; narrow the query)`);
	});

	it("redacts secrets before remembering, and records the agent session", async () => {
		const f = fake({ "POST /api/repos/dev/app/memory": { id: ID, text: "x", tags: [], pinned: false, createdBy: "dev", updatedAt: "" } });
		const secret = "sk_live_" + "a".repeat(24);
		const r = await callMemoryTool("memory_remember", { text: `Stripe key is ${secret}`, tags: ["payments"] }, checkout("11111111-2222-3333-4444-555555555555"), f.deps);
		expect(r.content[0]!.text).toBe(`Remembered [${ID}].`);
		const body = f.calls[0]!.body as { text: string; source: string; session: string; tags: string[] };
		expect(body.text).not.toContain(secret);
		expect(body).toMatchObject({ source: "mcp", session: "11111111-2222-3333-4444-555555555555", tags: ["payments"] });
	});

	it("updates and forgets by id, and explains missing scopes", async () => {
		const f = fake({ [`PATCH /api/repos/dev/app/memory/${ID}`]: {}, [`DELETE /api/repos/dev/app/memory/${ID}`]: {} });
		expect((await callMemoryTool("memory_update", { id: ID, pinned: true }, checkout(), f.deps)).content[0]!.text).toBe(`Updated [${ID}].`);
		expect((await callMemoryTool("memory_forget", { id: ID }, checkout(), f.deps)).content[0]!.text).toBe(`Forgot [${ID}].`);
		expect((await callMemoryTool("memory_forget", { id: "nope" }, checkout(), f.deps)).isError).toBe(true);
		const denied = fake({ "POST /api/repos/dev/app/memory": new ApiError(403, { error: "insufficient_scope" }) });
		expect((await callMemoryTool("memory_remember", { text: "x" }, checkout(), denied.deps)).content[0]!.text).toMatch(/run `appmarket login` again/);
	});
});
