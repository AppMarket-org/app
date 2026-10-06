import type { BufferEvent } from "../buffer.ts";
import { argsSummary, COMMIT_COMMAND } from "./claude-code.ts";

/** #120: Cursor hook input (common fields plus the per-event ones we use). */
export interface CursorInput {
	hook_event_name: string;
	conversation_id?: string;
	model?: string;
	model_id?: string;
	model_params?: { id?: string; value?: unknown }[];
	cursor_version?: string;
	workspace_roots?: string[];
	cwd?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown> | string;
	text?: string;
}

/** The hooks the adapter installs. Cursor has no usage numbers in hooks and no readable transcript format. */
export const CURSOR_EVENTS = ["sessionStart", "beforeSubmitPrompt", "postToolUse", "postToolUseFailure", "afterAgentResponse", "sessionEnd"] as const;

/** The repo the event happened in: the tool's cwd, else the first workspace root. */
export const cursorDirectory = (input: CursorInput): string | undefined => input.cwd ?? input.workspace_roots?.[0] ?? process.env.CURSOR_PROJECT_DIR;

const toolInput = (input: CursorInput): Record<string, unknown> => {
	if (typeof input.tool_input !== "string") return input.tool_input ?? {};
	try {
		return JSON.parse(input.tool_input) as Record<string, unknown>;
	} catch {
		return {};
	}
};

/** An agent's `git commit` (Cursor's Shell tool): the CLI makes the checkpoint right away. */
export function cursorCommitted(input: CursorInput): boolean {
	const command = toolInput(input).command;
	return input.hook_event_name === "postToolUse" && input.tool_name === "Shell" && typeof command === "string" && COMMIT_COMMAND.test(command);
}

/** Reasoning effort from model_params, when the model has such a setting. */
function effortOf(params: CursorInput["model_params"]): string | undefined {
	const param = params?.find((p) => /effort|reasoning|thinking/i.test(p.id ?? ""));
	return param && (typeof param.value === "string" || typeof param.value === "number" || typeof param.value === "boolean") ? String(param.value) : undefined;
}

/** Hook input → buffer events. Model, effort and Cursor's version come with every hook. */
export function cursorEvents(input: CursorInput, root?: string, now = new Date().toISOString()): BufferEvent[] {
	const base = { v: 1 as const, ts: now, harness: "cursor", session_id: input.conversation_id };
	const settings: BufferEvent = { ...base, type: "settings", model: input.model_id ?? input.model, effort: effortOf(input.model_params), harness_version: input.cursor_version };
	const withSettings = (event: BufferEvent): BufferEvent[] => (settings.model || settings.effort || settings.harness_version ? [event, settings] : [event]);
	switch (input.hook_event_name) {
		case "sessionStart":
			return withSettings({ ...base, type: "session.start", model: settings.model });
		case "beforeSubmitPrompt":
			return input.prompt ? withSettings({ ...base, type: "prompt", text: input.prompt }) : [];
		case "postToolUse":
		case "postToolUseFailure":
			return input.tool_name ? [{ ...base, type: "tool", name: input.tool_name, args: argsSummary(input.tool_name, toolInput(input), root), outcome: input.hook_event_name === "postToolUseFailure" ? "error" : "ok" }] : [];
		case "afterAgentResponse":
			return input.text ? [{ ...base, type: "assistant", text: input.text }] : [];
		case "sessionEnd":
			return [{ ...base, type: "session.end" }];
		default:
			return [];
	}
}

type CursorHooks = { version?: number; hooks?: Record<string, { command: string; timeout?: number }[]> } & Record<string, unknown>;

/** Adds (or removes) the appmarket hooks in a Cursor hooks.json, leaving every other hook alone. */
export function editCursorHooks(config: CursorHooks, install: boolean, command: string): CursorHooks {
	const hooks = { ...(config.hooks ?? {}) };
	for (const event of CURSOR_EVENTS) {
		const kept = (hooks[event] ?? []).filter((entry) => !entry.command.includes("appmarket hook cursor"));
		if (install) kept.push({ command, timeout: 10 });
		if (kept.length) hooks[event] = kept;
		else delete hooks[event];
	}
	const { hooks: _old, ...rest } = config;
	return Object.keys(hooks).length ? { version: 1, ...rest, hooks } : rest;
}
