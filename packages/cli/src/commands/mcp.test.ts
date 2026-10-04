import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-mcp-"));
const { handle } = await import("./mcp.ts");
const { addAgentsLine, AGENTS_MARK } = await import("./init.ts");
const { bufferKey, readSinceMarker } = await import("../buffer.ts");
const { buildRecord } = await import("../build-record.ts");
const { createRedactor } = await import("../redact.ts");

function repo(initialised = true): string {
	const root = mkdtempSync(join(tmpdir(), "am-mcp-repo-"));
	execFileSync("git", ["init", "-q", root]);
	if (initialised) execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
	return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
}

const call = (cwd: string, args: object) => handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "record_context", arguments: args } }, cwd) as { result: { content: { text: string }[]; isError?: boolean } };
const commit = { commit: "b".repeat(40), parents: [], branch: "main", author: { name: "D", email: "d@x.test" }, committedAt: "2026-10-04T10:00:00Z", files: [] };

describe("appmarket mcp", () => {
	it("speaks MCP: initialize, tools/list, notifications", () => {
		expect(handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "appmarket" } } });
		expect(handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).toMatchObject({ result: { tools: [{ name: "record_context" }] } });
		expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
		expect(handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({ error: { code: -32601 } });
	});

	it("records an agent-reported checkpoint", () => {
		const root = repo();
		expect(call(root, { prompt: "Add a counter", summary: "Added src/counter.ts" }).result.content[0]!.text).toContain("Recorded");
		const record = buildRecord(readSinceMarker(bufferKey(root)), commit, createRedactor());
		expect(record).toMatchObject({ harness: "mcp", source: "agent-reported", prompts: [{ text: "Add a counter" }], assistant_summary: "Added src/counter.ts" });
	});

	it("records nothing outside an initialised repo, and rejects an empty prompt", () => {
		expect(call(repo(false), { prompt: "x" }).result.content[0]!.text).toContain("nothing recorded");
		expect(call(repo(), { prompt: " " }).result.isError).toBe(true);
	});

	it("lets hook-captured prompts win over the agent's report", () => {
		const events = [
			{ v: 1 as const, ts: "2026-10-04T09:00:00Z", type: "prompt" as const, harness: "claude-code", text: "real prompt" },
			{ v: 1 as const, ts: "2026-10-04T09:01:00Z", type: "prompt" as const, harness: "mcp", text: "agent's paraphrase" },
		];
		const record = buildRecord(events, commit, createRedactor());
		expect(record).toMatchObject({ harness: "claude-code", source: "harness" });
		expect(record.prompts.map((p) => p.text)).toEqual(["real prompt"]);
	});
});

describe("AGENTS.md line", () => {
	it("is added once, to CLAUDE.md when only that exists", () => {
		const root = repo();
		writeFileSync(join(root, "CLAUDE.md"), "# Notes");
		expect(addAgentsLine(root)).toBe(join(root, "CLAUDE.md"));
		expect(addAgentsLine(root)).toBeNull();
		const text = readFileSync(join(root, "CLAUDE.md"), "utf8");
		expect(text.startsWith("# Notes\n\n" + AGENTS_MARK)).toBe(true);
		expect(text.split(AGENTS_MARK)).toHaveLength(2);
		const fresh = repo();
		expect(addAgentsLine(fresh)).toBe(join(fresh, "AGENTS.md"));
	});
});
