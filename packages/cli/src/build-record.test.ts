import { checkpointRecordSchema } from "@appmarket/shared/schemas";
import { describe, expect, it } from "vitest";
import type { BufferEvent } from "./buffer.ts";
import { buildRecord } from "./build-record.ts";
import { effortLevel } from "./effort.ts";
import { createRedactor } from "./redact.ts";

const commit = {
	commit: "b".repeat(40),
	parents: ["a".repeat(40)],
	branch: "main",
	author: { name: "Dev", email: "dev@example.test" },
	committedAt: "2026-10-03T10:10:00Z",
	files: [{ path: "src/index.ts", added: 3, removed: 1 }],
};
const ev = (e: Partial<BufferEvent>): BufferEvent => ({ v: 1, ts: "2026-10-03T10:00:00Z", harness: "claude-code", type: "prompt", ...e }) as BufferEvent;

describe("buildRecord", () => {
	it("computes effort metrics from events and redacts text", () => {
		const events = [
			ev({ type: "settings", model: "claude-opus-5-5", effort: "high", harness_version: "2.1.0", session_id: "s1" }),
			ev({ type: "prompt", text: "Add a counter", ts: "2026-10-03T10:00:00Z" }),
			ev({ type: "tool", name: "Bash", args: "npm test", outcome: "error" }),
			ev({ type: "tool", name: "Bash", args: "npm test" }),
			ev({ type: "tool", name: "Read", args: ".env.local" }),
			ev({ type: "assistant", text: `Done. Used key ${"sk-ant-" + "y".repeat(30)}` }),
			ev({ type: "usage", input_tokens: 100, output_tokens: 20 }),
			ev({ type: "usage", input_tokens: 50, output_tokens: 5 }),
		];
		const r = buildRecord(events, commit, createRedactor(), new Date("2026-10-03T10:10:01Z"));
		expect(checkpointRecordSchema.safeParse(r).success).toBe(true);
		expect(r).toMatchObject({
			harness: "claude-code",
			model: "claude-opus-5-5",
			session_id: "s1",
			effort: { raw: "high", level: "high" },
			effort_metrics: { turns: 1, wall_clock_s: 600, tool_calls: 3, retries: 1, reasoning_tokens: null },
			usage: { input_tokens: 150, output_tokens: 25, cost_usd: null },
			source: "harness",
			redactions: 1,
		});
		expect(r.assistant_summary).toContain("[redacted:anthropic]");
		expect(r.tools[2]).toMatchObject({ name: "Read", args_summary: "" });
	});

	it("makes a harness 'none' record for a commit with no agent events", () => {
		const r = buildRecord([], commit, createRedactor());
		expect(r).toMatchObject({ harness: "none", prompts: [], effort: { level: "unknown" }, files: commit.files });
		expect(checkpointRecordSchema.safeParse(r).success).toBe(true);
	});

	it("marks MCP-reported events as agent-reported", () => {
		expect(buildRecord([ev({ harness: "mcp", text: "hi" })], commit, createRedactor()).source).toBe("agent-reported");
	});
});

describe("effortLevel", () => {
	it("normalises harness settings", () => {
		expect([effortLevel("minimal"), effortLevel("Medium"), effortLevel("high"), effortLevel("xhigh"), effortLevel(""), effortLevel("weird")]).toEqual(["low", "medium", "high", "max", "unknown", "unknown"]);
	});
});
