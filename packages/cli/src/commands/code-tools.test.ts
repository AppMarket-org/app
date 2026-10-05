import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-code-"));
const { callCodeTool } = await import("./code-tools.ts");

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "am-code-repo-"));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
	return root;
}

const fake = (response: unknown) => {
	const paths: string[] = [];
	return { paths, deps: { token: async () => "t", call: (async (_api: string, path: string) => (paths.push(path), response)) as never } };
};

describe("code graph MCP tools (#240)", () => {
	it("lists definitions with file:line", async () => {
		const f = fake({ commit: "a".repeat(40), symbols: [{ path: "src/db.ts", name: "Store", kind: "class", line: 12, exported: true }] });
		const r = await callCodeTool("code_find_symbol", { name: "Store" }, repo(), f.deps);
		expect(f.paths).toEqual(["/api/repos/dev/app/code-graph/symbols?q=Store"]);
		expect(r.content[0]!.text).toContain("src/db.ts:12  export class Store");
	});

	it("asks for the impact of several paths at once", async () => {
		const f = fake({ commit: "b".repeat(40), affected: [{ path: "src/api.ts", depth: 1, via: "src/db.ts" }, { path: "src/main.ts", depth: 2, via: "src/api.ts" }] });
		const r = await callCodeTool("code_impact", { paths: ["src/db.ts", "src/lib/"] }, repo(), f.deps);
		expect(f.paths).toEqual(["/api/repos/dev/app/code-graph/impact?paths=src%2Fdb.ts%2Csrc%2Flib%2F"]);
		expect(r.content[0]!.text).toContain("src/main.ts  (2 levels, via src/api.ts)");
	});

	it("needs an appmarket repo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "am-code-none-"));
		execFileSync("git", ["init", "-q", dir]);
		expect((await callCodeTool("code_references", { path: "a.ts" }, dir, fake({}).deps)).isError).toBe(true);
	});
});
