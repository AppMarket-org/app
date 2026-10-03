import { closeSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { BufferEvent } from "../buffer.ts";

/** Claude Code hook input (common fields plus the per-event ones we use). */
export interface HookInput {
	hook_event_name: string;
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	prompt?: string;
	model?: string | { id?: string };
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_response?: unknown;
}

export const COMMIT_COMMAND = /\bgit\b[^\n|;&]*\bcommit\b/;

function sizeOf(path?: string): number | undefined {
	try {
		return path ? statSync(path).size : undefined;
	} catch {
		return undefined;
	}
}

/**
 * One line per tool call: the command, the file, or the pattern; not the whole input. Paths become
 * relative to the repo, and the home directory `~`, so the record does not carry the machine's user name.
 */
export function argsSummary(tool: string, input: Record<string, unknown> = {}, root?: string): string {
	const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
	const value = pick("command") ?? pick("file_path") ?? pick("notebook_path") ?? pick("pattern") ?? pick("url") ?? pick("query") ?? pick("description");
	let out = (value ?? (tool.startsWith("mcp__") ? Object.keys(input).join(",") : "")).replace(/\s+/g, " ");
	if (root) out = out.split(`${root}/`).join("").split(root).join(".");
	const home = homedir();
	if (home.length > 1) out = out.split(home).join("~");
	return out.slice(0, 1024);
}

function failed(response: unknown): boolean {
	if (!response || typeof response !== "object") return false;
	const r = response as Record<string, unknown>;
	return r.is_error === true || r.success === false || typeof r.error === "string" || r.interrupted === true;
}

/** Hook input → buffer events (#112). Model, effort and usage come later from the transcript. */
export function eventsFor(input: HookInput, now = new Date().toISOString(), root?: string): BufferEvent[] {
	const base = { v: 1 as const, ts: now, harness: "claude-code", session_id: input.session_id, transcript_path: input.transcript_path };
	const model = typeof input.model === "string" ? input.model : input.model?.id;
	switch (input.hook_event_name) {
		case "SessionStart":
			return [{ ...base, type: "session.start", model, transcript_offset: sizeOf(input.transcript_path) }];
		case "UserPromptSubmit":
			return input.prompt ? [{ ...base, type: "prompt", text: input.prompt, transcript_offset: sizeOf(input.transcript_path) }] : [];
		case "PostToolUse":
		case "PostToolUseFailure":
			return input.tool_name
				? [{ ...base, type: "tool", name: input.tool_name, args: argsSummary(input.tool_name, input.tool_input, root), outcome: input.hook_event_name === "PostToolUseFailure" || failed(input.tool_response) ? "error" : "ok" }]
				: [];
		case "SessionEnd":
			return [{ ...base, type: "session.end" }];
		default:
			return [];
	}
}

interface TranscriptLine {
	type?: string;
	timestamp?: string;
	version?: string;
	effort?: string;
	isSidechain?: boolean;
	message?: {
		id?: string;
		model?: string;
		content?: { type: string; text?: string }[];
		usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } };
	};
}

/**
 * Reads the transcript from `offset`, keeping lines between `since` and `until`, and turns it into settings, usage and
 * assistant events. Each API message is counted once (the transcript repeats it per content block).
 */
export function transcriptEvents(path: string, offset: number, until: string, since = ""): BufferEvent[] {
	let text: string;
	try {
		const size = statSync(path).size;
		const start = Math.min(Math.max(offset, 0), size);
		const fd = openSync(path, "r");
		const buffer = Buffer.alloc(size - start);
		readSync(fd, buffer, 0, buffer.length, start);
		closeSync(fd);
		text = buffer.toString("utf8");
	} catch {
		return [];
	}
	const events: BufferEvent[] = [];
	const seen = new Set<string>();
	let lastText = "";
	let last: TranscriptLine | undefined;
	for (const raw of text.split("\n")) {
		if (!raw.includes('"type":"assistant"')) continue;
		let line: TranscriptLine;
		try {
			line = JSON.parse(raw) as TranscriptLine;
		} catch {
			continue;
		}
		if (line.type !== "assistant" || !line.timestamp || line.timestamp > until || line.timestamp < since) continue;
		last = line;
		const textBlock = line.message?.content?.filter((c) => c.type === "text" && c.text).at(-1)?.text;
		if (textBlock && !line.isSidechain) lastText = textBlock;
		const id = line.message?.id;
		const usage = line.message?.usage;
		if (!id || !usage || seen.has(id)) continue;
		seen.add(id);
		events.push({
			v: 1,
			ts: line.timestamp,
			type: "usage",
			harness: "claude-code",
			input_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
			output_tokens: usage.output_tokens ?? 0,
			reasoning_tokens: usage.output_tokens_details?.thinking_tokens,
		});
	}
	if (last) events.push({ v: 1, ts: last.timestamp!, type: "settings", harness: "claude-code", model: last.message?.model, effort: last.effort, harness_version: last.version });
	if (lastText) events.push({ v: 1, ts: last!.timestamp!, type: "assistant", harness: "claude-code", text: lastText });
	return events;
}
