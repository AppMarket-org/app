import { CHECKPOINT_LIMITS, CHECKPOINT_SCHEMA, HARNESSES, type CheckpointRecord, type Harness } from "@appmarket/shared";
import type { BufferEvent } from "./buffer.ts";
import { effortLevel } from "./effort.ts";
import type { Redactor } from "./redact.ts";

export interface CommitInfo {
	commit: string;
	parents: string[];
	branch: string;
	author: { name: string; email: string };
	/** Commit time (ISO), for wall_clock_s. */
	committedAt: string;
	files: { path: string; added: number; removed: number }[];
}

export const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * Turns the buffer events since the last checkpoint into a record (#109, #114). Effort metrics are
 * computed here from the events, never taken from the agent. Everything textual goes through the
 * redactor first (#115).
 */
export function buildRecord(all: BufferEvent[], commit: CommitInfo, redactor: Redactor, now = new Date()): CheckpointRecord {
	// Hook-captured events win: an agent that also calls record_context (MCP) would repeat the prompt.
	const events = all.some((e) => e.harness !== "mcp" && e.type === "prompt") ? all.filter((e) => e.harness !== "mcp") : all;
	const harnessOf = (e?: BufferEvent): Harness => ((HARNESSES as readonly string[]).includes(e?.harness ?? "") ? (e!.harness as Harness) : "mcp");
	const first = events[0];
	const harness: Harness = events.length ? harnessOf(first) : "none";
	const last = <T>(pick: (e: BufferEvent) => T | undefined): T | undefined => events.reduce<T | undefined>((acc, e) => pick(e) ?? acc, undefined);

	const prompts = events.filter((e) => e.type === "prompt" && e.text).map((e) => ({ ts: e.ts, text: redactor.text(e.text!) }));
	const toolEvents = events.filter((e) => e.type === "tool" && e.name);
	const tools = toolEvents.slice(-CHECKPOINT_LIMITS.tools).map((e) => ({
		name: e.name!,
		args_summary: e.args && !redactor.sensitivePath(e.args) ? truncate(redactor.text(e.args), 1024) : "",
		outcome: e.outcome === "error" ? ("error" as const) : ("ok" as const),
		ts: e.ts,
	}));
	// A retry is a failed tool call followed by another call to the same tool.
	const retries = toolEvents.filter((e, i) => e.outcome === "error" && toolEvents.slice(i + 1).some((n) => n.name === e.name)).length;
	const usage = events.filter((e) => e.type === "usage");
	const sum = (pick: (e: BufferEvent) => number | undefined) => (usage.some((e) => pick(e) !== undefined) ? usage.reduce((n, e) => n + (pick(e) ?? 0), 0) : null);
	const assistant = last((e) => (e.type === "assistant" ? e.text : undefined)) ?? "";
	const effortRaw = last((e) => e.effort) ?? "";
	const startedAt = prompts[0]?.ts ?? first?.ts;
	const wallClock = startedAt ? Math.max(0, Math.round((Date.parse(commit.committedAt) - Date.parse(startedAt)) / 1000)) : 0;
	const source = harness === "mcp" ? ("agent-reported" as const) : ("harness" as const);

	const record: CheckpointRecord = {
		schema: CHECKPOINT_SCHEMA,
		commit: commit.commit,
		parents: commit.parents,
		branch: commit.branch,
		author: commit.author,
		harness,
		harness_version: last((e) => e.harness_version) ?? "",
		session_id: last((e) => e.session_id) ?? "",
		model: last((e) => e.model) ?? "",
		effort: { raw: effortRaw, level: effortLevel(effortRaw) },
		effort_metrics: { turns: prompts.length, wall_clock_s: wallClock, tool_calls: toolEvents.length, retries, reasoning_tokens: sum((e) => e.reasoning_tokens) },
		prompts: prompts.slice(-CHECKPOINT_LIMITS.prompts),
		assistant_summary: truncate(redactor.text(assistant), CHECKPOINT_LIMITS.assistantSummaryChars),
		tools,
		usage: {
			input_tokens: sum((e) => e.input_tokens),
			output_tokens: sum((e) => e.output_tokens),
			cost_usd: sum((e) => e.cost_usd),
			cache_read_tokens: sum((e) => e.cache_read_tokens),
			cache_write_tokens: sum((e) => e.cache_write_tokens),
		},
		files: commit.files.slice(0, CHECKPOINT_LIMITS.files),
		redactions: 0,
		source,
		created_at: now.toISOString(),
	};
	if (toolEvents.length > CHECKPOINT_LIMITS.tools || commit.files.length > CHECKPOINT_LIMITS.files || prompts.length > CHECKPOINT_LIMITS.prompts) record.truncated = true;
	record.redactions = redactor.count;
	return record;
}
