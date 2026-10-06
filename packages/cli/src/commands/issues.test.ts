import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-issue-"));
const { ApiError } = await import("../api.ts");
const { callIssueTool } = await import("./issue-tools.ts");
const { issue } = await import("./issue.ts");

function checkout(): string {
	const root = mkdtempSync(join(tmpdir(), "am-issue-repo-"));
	execFileSync("git", ["init", "-q", "-b", "main", root]);
	execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
	return root;
}

const bug = {
	number: 7,
	title: "Flags vanish",
	body: "Long press on iOS.",
	type: "bug",
	priority: "high",
	state: "open",
	reason: null,
	assignee: { kind: "agents" },
	author: "dev",
	comments: 1,
	createdAt: "2026-10-06T00:00:00Z",
	work: { status: "claimed", agent: "Claude Code", pull: null },
};

function fake(routes: Record<string, unknown>) {
	const calls: { path: string; method?: string; body?: unknown }[] = [];
	return {
		calls,
		deps: {
			token: async () => "t",
			call: (async (_api: string, path: string, init: { method?: string; body?: unknown } = {}) => {
				calls.push({ path, method: init.method, body: init.body });
				const hit = routes[`${init.method ?? "GET"} ${path}`];
				if (hit instanceof Error) throw hit;
				if (hit === undefined) throw new ApiError(404, { error: "not_found" });
				return hit;
			}) as never,
		},
	};
}

describe("issue MCP tools (#297)", () => {
	it("reads an issue with how its board task stands and its comments", async () => {
		const f = fake({ "GET /api/repos/dev/app": { fullName: "dev/app", forkedFrom: null }, "GET /api/repos/dev/app/issues/7": bug, "GET /api/repos/dev/app/issues/7/comments": { items: [{ author: "dev", body: "Only on Safari", createdAt: "2026-10-06T01:00:00Z" }] } });
		const r = await callIssueTool("issue_view", { number: 7 }, checkout(), f.deps);
		const text = r.content[0]!.text;
		expect(text).toMatch(/^#7 Flags vanish {2}\[open\]/);
		expect(text).toContain("Bug · high priority · assigned to Agents");
		expect(text).toContain("Agents board: Claude Code is working on it");
		expect(text).toContain("Long press on iOS.");
		expect(text).toContain("dev (2026-10-06 01:00): Only on Safari");
	});

	it("comments, and explains a sign-in without issues:write", async () => {
		const ok = fake({ "GET /api/repos/dev/app": { fullName: "dev/app", forkedFrom: null }, "POST /api/repos/dev/app/issues/7/comments": { id: "c" } });
		expect((await callIssueTool("issue_comment", { number: 7, body: "On it" }, checkout(), ok.deps)).content[0]!.text).toBe("Commented on #7.");
		expect(ok.calls.at(-1)).toEqual({ path: "/api/repos/dev/app/issues/7/comments", method: "POST", body: { body: "On it" } });
		const denied = fake({ "GET /api/repos/dev/app": { fullName: "dev/app", forkedFrom: null }, "POST /api/repos/dev/app/issues/7/comments": new ApiError(403, { error: "insufficient_scope" }) });
		const r = await callIssueTool("issue_comment", { number: 7, body: "On it" }, checkout(), denied.deps);
		expect(r.isError).toBe(true);
		expect(r.content[0]!.text).toMatch(/cannot change issues: run `appmarket login` again/);
	});
});

describe("appmarket issue (#297)", () => {
	const ctx = (routes: Record<string, unknown>) => {
		const f = fake(routes);
		const call = <T>(path: string, init: { method?: string; body?: unknown } = {}) => (f.deps.call as unknown as (a: string, p: string, i: unknown) => Promise<T>)("https://x.test", path, init);
		return { f, get: async () => ({ api: "https://x.test", token: "t", source: "dev/app", target: "dev/app", branch: null, call }) };
	};

	it("creates an issue for agents and closes one as not planned", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const c = ctx({ "POST /api/repos/dev/app/issues": bug, "PATCH /api/repos/dev/app/issues/7": { ...bug, state: "closed", reason: "not_planned", work: null } });
		expect(await issue("create", [], { title: "Flags vanish", type: "bug", priority: "high", assign: "agents" }, c.get)).toBe(0);
		expect(c.f.calls[0]).toEqual({ path: "/api/repos/dev/app/issues", method: "POST", body: { title: "Flags vanish", body: undefined, type: "bug", priority: "high", assignee: "agents" } });
		expect(await issue("close", ["7"], { notPlanned: true }, c.get)).toBe(0);
		expect(c.f.calls[1]!.body).toEqual({ state: "closed", reason: "not_planned" });
		expect(log.mock.calls.at(-1)![0]).toMatch(/\[closed: not planned\]/);
		log.mockRestore();
	});

	it("needs a number for view, comment, close and reopen", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(await issue("view", [], {}, ctx({}).get)).toBe(1);
		expect(err.mock.calls[0]![0]).toMatch(/^Usage: appmarket issue/);
		err.mockRestore();
	});
});
