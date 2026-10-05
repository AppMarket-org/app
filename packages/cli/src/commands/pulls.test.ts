import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe as suite, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-pr-"));
const { ApiError } = await import("../api.ts");
const { callPrTool } = await import("./pr-tools.ts");

function checkout(branch = "feature/x"): string {
	const root = mkdtempSync(join(tmpdir(), "am-pr-repo-"));
	execFileSync("git", ["init", "-q", "-b", branch, root]);
	execFileSync("git", ["config", "appmarket.repo", "you/fork"], { cwd: root });
	return root;
}

const pull = { number: 4, title: "Add score", body: "", state: "open", author: "you", source: { repo: "you/fork", branch: "feature/x", fork: true }, target: { repo: "dev/app", branch: "main" }, headSha: null, mergedSha: null, merge: null, review: { decision: null, approvals: 0 }, mergeBlocked: null, canMerge: false };

function fake(routes: Record<string, unknown>) {
	const calls: { path: string; method?: string; body?: unknown }[] = [];
	return {
		calls,
		deps: {
			token: async () => "t",
			call: (async (_api: string, path: string, init: { method?: string; body?: unknown } = {}) => {
				calls.push({ path, method: init.method, body: init.body });
				const key = `${init.method ?? "GET"} ${path}`;
				const hit = routes[key];
				if (hit instanceof Error) throw hit;
				if (hit === undefined) throw new ApiError(404, { error: "not_found" });
				return hit;
			}) as never,
		},
	};
}

suite("pull request tools (#260)", () => {
	it("opens a fork's branch against the repo it was forked from", async () => {
		const f = fake({ "GET /api/repos/you/fork": { fullName: "you/fork", forkedFrom: { fullName: "dev/app" } }, "POST /api/repos/dev/app/pulls": pull });
		const r = await callPrTool("pr_open", { title: "Add score" }, checkout(), f.deps);
		expect(f.calls[1]).toEqual({ path: "/api/repos/dev/app/pulls", method: "POST", body: { title: "Add score", body: "", source: "you/fork", sourceBranch: "feature/x" } });
		expect(r.content[0]!.text).toContain("#4 Add score");
		expect(r.content[0]!.text).toContain("you/fork:feature/x → dev/app:main");
	});

	it("returns the pull request already open for the branch", async () => {
		const f = fake({
			"GET /api/repos/you/fork": { fullName: "you/fork", forkedFrom: { fullName: "dev/app" } },
			"POST /api/repos/dev/app/pulls": new ApiError(409, { error: "conflict", number: 4 }),
			"GET /api/repos/dev/app/pulls/4": { ...pull, mergeBlocked: "Changes were requested." },
		});
		const r = await callPrTool("pr_open", { title: "Again" }, checkout(), f.deps);
		expect(r.content[0]!.text).toContain("Cannot merge yet: Changes were requested.");
	});

	it("finds the current branch's pull request and reads its conversation", async () => {
		const f = fake({
			"GET /api/repos/you/fork": { fullName: "you/fork", forkedFrom: { fullName: "dev/app" } },
			"GET /api/repos/dev/app/pulls?state=open": { items: [pull] },
			"GET /api/repos/dev/app/pulls/4/comments": {
				comments: [{ id: "c", author: "dev", body: "Cache this?", path: "src/a.ts", line: 9, side: "new", createdAt: "2" }],
				reviews: [{ reviewer: "dev", state: "changes_requested", body: "See the comment.", createdAt: "1" }],
			},
		});
		const r = await callPrTool("pr_comments", {}, checkout(), f.deps);
		expect(r.content[0]!.text).toBe("#4 Add score\n\ndev requested changes: See the comment.\n\ndev on src/a.ts:9 (new): Cache this?");
	});

	it("explains a branch that was not pushed yet", async () => {
		const f = fake({ "GET /api/repos/you/fork": { fullName: "you/fork", forkedFrom: null }, "POST /api/repos/you/fork/pulls": new ApiError(400, { message: "feature/x does not exist in you/fork." }) });
		const r = await callPrTool("pr_open", { title: "x" }, checkout(), f.deps);
		expect(r).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("push it first") }] });
	});
});
