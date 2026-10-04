import type { CheckpointRecord } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { fitRecord } from "./fit.ts";

const base = {
	schema: "appmarket.checkpoint/1",
	commit: "a".repeat(40),
	parents: [],
	branch: "main",
	author: { name: "d", email: "d@x.test" },
	harness: "claude-code",
	harness_version: "",
	session_id: "s",
	model: "m",
	effort: { raw: "", level: "unknown" },
	effort_metrics: { turns: 0, wall_clock_s: 0, tool_calls: 0, retries: 0, reasoning_tokens: null },
	prompts: [],
	assistant_summary: "",
	tools: [],
	usage: { input_tokens: null, output_tokens: null, cost_usd: null },
	files: [],
	redactions: 0,
	source: "harness",
	created_at: "2026-10-04T00:00:00Z",
} as CheckpointRecord;

describe("fitRecord (#129)", () => {
	it("sends small records as they are", () => {
		expect(fitRecord(base)).toEqual({ record: base });
	});

	it("trims a large record under 256 KB and keeps the full one as the transcript", () => {
		const big = { ...base, prompts: Array.from({ length: 200 }, (_, i) => ({ ts: "2026-10-04T00:00:00Z", text: `prompt ${i} ` + "x".repeat(5000) })) };
		const { record, transcript } = fitRecord(big);
		expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(256 * 1024);
		expect(record.truncated).toBe(true);
		expect(record.prompts.at(-1)!.text.startsWith("prompt 199")).toBe(true);
		expect(transcript).toBe(big);
	});
});
