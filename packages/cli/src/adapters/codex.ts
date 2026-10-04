import { readFileSync } from "node:fs";
import type { BufferEvent } from "../buffer.ts";

interface RolloutLine {
	timestamp?: string;
	type?: string;
	payload?: {
		type?: string;
		role?: string;
		phase?: string;
		model?: string;
		effort?: string;
		collaboration_mode?: { settings?: { reasoning_effort?: string } };
		content?: { type: string; text?: string }[];
		info?: {
			total_token_usage?: { total_tokens?: number };
			last_token_usage?: { input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
		} | null;
	};
}

/**
 * #118: Codex's rollout file (the hook's transcript_path) → settings, usage and assistant events
 * between `since` and `until`. Prompts and tool calls come from Codex hooks, like Claude Code.
 */
export function codexTranscriptEvents(path: string, offset: number, until: string, since = ""): BufferEvent[] {
	let text: string;
	let whole: string;
	try {
		// Codex writes turn_context (model, effort) when a turn starts, before the first hook fires,
		// so settings are the latest turn_context up to the commit, from anywhere in the file.
		const bytes = readFileSync(path);
		whole = bytes.toString("utf8");
		text = bytes.subarray(Math.min(Math.max(offset, 0), bytes.length)).toString("utf8");
	} catch {
		return [];
	}
	// session_meta is the first line (it can be long: it carries the base instructions).
	const version = /"cli_version":"([^"]+)"/.exec(whole.slice(0, 256 * 1024))?.[1];
	const events: BufferEvent[] = [];
	const totals = new Set<number>();
	let model: string | undefined;
	let effort: string | undefined;
	let last = "";
	for (const raw of whole.split("\n")) {
		if (!raw.includes('"turn_context"')) continue;
		try {
			const line = JSON.parse(raw) as RolloutLine;
			if (line.type !== "turn_context" || !line.timestamp || line.timestamp > until) continue;
			model = line.payload?.model ?? model;
			effort = line.payload?.effort ?? line.payload?.collaboration_mode?.settings?.reasoning_effort ?? effort;
			last = line.timestamp;
		} catch {
			// Partial line: skip.
		}
	}
	let assistant: { ts: string; text: string } | undefined;
	for (const raw of text.split("\n")) {
		if (!raw.includes('"token_count"') && !raw.includes('"role":"assistant"')) continue;
		let line: RolloutLine;
		try {
			line = JSON.parse(raw) as RolloutLine;
		} catch {
			continue;
		}
		const ts = line.timestamp;
		if (!ts || ts > until || ts < since) continue;
		const p = line.payload ?? {};
		if (p.type === "token_count" && p.info?.last_token_usage) {
			// The same running total can be reported more than once; count each call once.
			const total = p.info.total_token_usage?.total_tokens;
			if (total !== undefined && totals.has(total)) continue;
			if (total !== undefined) totals.add(total);
			const u = p.info.last_token_usage;
			events.push({ v: 1, ts, type: "usage", harness: "codex", input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, reasoning_tokens: u.reasoning_output_tokens });
		} else if (p.type === "message" && p.role === "assistant") {
			const textPart = p.content?.filter((c) => c.type === "output_text" && c.text).at(-1)?.text;
			if (textPart) assistant = { ts, text: textPart };
		}
	}
	if (model || effort || version) events.push({ v: 1, ts: last || since, type: "settings", harness: "codex", model, effort, harness_version: version });
	if (assistant) events.push({ v: 1, ts: assistant.ts, type: "assistant", harness: "codex", text: assistant.text });
	return events;
}
