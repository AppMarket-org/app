import type { CheckpointRecord } from "@appmarket/shared";

/** Test fixtures for checkpoint records. */
export const sha = (n: number) => n.toString(16).padStart(40, "a");
export function record(n: number, prompt = "Add a todo list"): CheckpointRecord {
	return {
		schema: "appmarket.checkpoint/1",
		commit: sha(n),
		parents: [sha(n - 1)],
		branch: "main",
		author: { name: "Dev", email: "dev@example.test" },
		harness: "claude-code",
		harness_version: "2.1.0",
		session_id: "s1",
		model: "claude-opus-5-5",
		effort: { raw: "high", level: "high" },
		effort_metrics: { turns: 1, wall_clock_s: 30, tool_calls: 4, retries: 0, reasoning_tokens: 1200 },
		prompts: [{ ts: "2026-10-03T10:00:00.000Z", text: prompt }],
		assistant_summary: "Added the list.",
		tools: [{ name: "Edit", args_summary: "src/todo.ts", outcome: "ok", ts: "2026-10-03T10:00:10.000Z" }],
		usage: { input_tokens: 1000, output_tokens: 200, cost_usd: null },
		files: [{ path: "src/todo.ts", added: 10, removed: 0 }],
		redactions: 0,
		source: "harness",
		created_at: "2026-10-03T10:00:30.000Z",
	};
}
