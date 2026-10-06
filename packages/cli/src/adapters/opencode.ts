import { homedir } from "node:os";
import { join } from "node:path";
import type { BufferEvent } from "../buffer.ts";
import { argsSummary } from "./claude-code.ts";

/**
 * #119: what the OpenCode plugin sends to `appmarket hook opencode`, one JSON object per process.
 * OpenCode has no transcript file to read at commit time, so the plugin sends model, usage and the
 * final answer as they happen, from its events.
 */
export interface OpencodeInput {
	event: "session.start" | "prompt" | "tool" | "settings" | "usage" | "assistant";
	/** OpenCode's working directory: which repo the session is in. */
	directory?: string;
	ts?: string;
	sessionID?: string;
	text?: string;
	model?: string;
	effort?: string;
	version?: string;
	tool?: string;
	args?: Record<string, unknown>;
	error?: boolean;
	tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
	cost?: number;
}

/** The plugin's input → buffer events. */
export function opencodeEvents(input: OpencodeInput, root?: string, now = new Date().toISOString()): BufferEvent[] {
	const base = { v: 1 as const, ts: input.ts ?? now, harness: "opencode", session_id: input.sessionID };
	switch (input.event) {
		case "session.start":
			return [{ ...base, type: "session.start", harness_version: input.version }];
		case "prompt":
			return input.text ? [{ ...base, type: "prompt", text: input.text }, ...(input.model || input.effort ? [{ ...base, type: "settings" as const, model: input.model, effort: input.effort, harness_version: input.version }] : [])] : [];
		case "settings":
			return input.model || input.effort || input.version ? [{ ...base, type: "settings", model: input.model, effort: input.effort, harness_version: input.version }] : [];
		case "tool":
			return input.tool ? [{ ...base, type: "tool", name: input.tool, args: argsSummary(input.tool, input.args, root), outcome: input.error ? "error" : "ok" }] : [];
		case "usage": {
			const t = input.tokens;
			if (!t) return [];
			const read = t.cache?.read ?? 0;
			const write = t.cache?.write ?? 0;
			// OpenCode counts cached input separately; the record's input_tokens includes it (as for Claude Code).
			return [{ ...base, type: "usage", input_tokens: (t.input ?? 0) + read + write, output_tokens: t.output ?? 0, reasoning_tokens: t.reasoning, cache_read_tokens: read, cache_write_tokens: write, cost_usd: input.cost }];
		}
		case "assistant":
			return input.text ? [{ ...base, type: "assistant", text: input.text }] : [];
		default:
			return [];
	}
}

/** OpenCode's global config directory (plugins/ and opencode.json live here). */
export function opencodeDir(): string {
	return process.env.OPENCODE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode");
}

export const opencodePluginPath = () => join(opencodeDir(), "plugins", "appmarket.ts");

type OpencodeConfig = { mcp?: Record<string, unknown> } & Record<string, unknown>;

/** Adds (or removes) the `appmarket mcp` server, leaving the rest of opencode.json alone. */
export function editOpencodeConfig(config: OpencodeConfig, install: boolean): OpencodeConfig {
	const { appmarket: _old, ...others } = config.mcp ?? {};
	const mcp = install ? { ...others, appmarket: { type: "local", command: ["appmarket", "mcp"], enabled: true } } : others;
	const { mcp: _mcp, ...rest } = config;
	return Object.keys(mcp).length ? { ...rest, mcp } : rest;
}

/**
 * The plugin OpenCode loads from ~/.config/opencode/plugins (Bun runs it). It only forwards events:
 * each one goes to a detached `appmarket hook opencode` it does not wait for, so OpenCode is never
 * slowed down or broken by it, and a machine without the CLI just skips it. The CLI decides what
 * to keep (only repos where `appmarket init` ran).
 */
export const OPENCODE_PLUGIN = `// appmarket.org checkpoints for OpenCode. Installed by \`appmarket adapter install opencode\`;
// remove with \`appmarket adapter uninstall opencode\`. Sends prompts, tool calls, model, effort,
// token usage and the final answer to \`appmarket hook opencode\`, which records them only in repos
// where \`appmarket init\` ran. It never waits for the CLI and never throws.
import { execFile, spawn } from "node:child_process";

export const AppmarketPlugin = async ({ directory }) => {
	let version;
	try {
		execFile("opencode", ["--version"], { timeout: 5000 }, (error, stdout) => {
			if (!error) version = String(stdout).trim().split(/\\s+/).pop();
		});
	} catch {}
	const send = (event) => {
		try {
			const child = spawn("appmarket", ["hook", "opencode"], { stdio: ["pipe", "ignore", "ignore"], detached: true });
			child.on("error", () => {});
			child.stdin.on("error", () => {});
			child.stdin.end(JSON.stringify({ ...event, directory, version, ts: new Date().toISOString() }));
			child.unref();
		} catch {}
	};
	const subagents = new Set(); // sessions started by the task tool: their prompts are the agent's, not yours
	const models = new Set(); // assistant messages whose model was sent
	const steps = new Set(); // step-finish parts already counted
	const tools = new Set(); // tool calls already sent
	const texts = new Map(); // assistant message → its latest text
	return {
		"chat.message": async (input, output) => {
			if (subagents.has(input.sessionID)) return;
			const text = (output?.parts ?? []).filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text).join("\\n").trim();
			if (text) send({ event: "prompt", sessionID: input.sessionID, text, model: input.model?.modelID, effort: input.variant });
		},
		event: async ({ event }) => {
			try {
				const props = event.properties ?? {};
				if (event.type === "session.created") {
					if (props.info?.parentID) subagents.add(props.info.id);
					else send({ event: "session.start", sessionID: props.info?.id });
				} else if (event.type === "message.updated") {
					const m = props.info;
					if (m?.role !== "assistant") return;
					if (!models.has(m.id) && m.modelID) {
						models.add(m.id);
						send({ event: "settings", sessionID: m.sessionID, model: m.modelID });
					}
					if (m.time?.completed && texts.has(m.id)) {
						if (!subagents.has(m.sessionID)) send({ event: "assistant", sessionID: m.sessionID, text: texts.get(m.id) });
						texts.delete(m.id);
					}
				} else if (event.type === "message.part.updated") {
					const p = props.part;
					if (p?.type === "text" && !p.synthetic && p.text) texts.set(p.messageID, p.text);
					else if (p?.type === "step-finish" && !steps.has(p.id)) {
						steps.add(p.id);
						send({ event: "usage", sessionID: p.sessionID, tokens: p.tokens, cost: p.cost });
					} else if (p?.type === "tool" && (p.state?.status === "completed" || p.state?.status === "error") && !tools.has(p.callID)) {
						tools.add(p.callID);
						send({ event: "tool", sessionID: p.sessionID, tool: p.tool, args: p.state.input, error: p.state.status === "error" });
					}
				}
			} catch {}
		},
	};
};
`;
