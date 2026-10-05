import { createInterface } from "node:readline";
import { append, bufferKey } from "../buffer.ts";
import { VERSION } from "../config.ts";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { callPlaneTool, PLANE_TOOL_NAMES, PLANE_TOOLS } from "./plane-tools.ts";

/** #121: the one tool every harness gets, with the same name and behaviour everywhere. */
export const RECORD_CONTEXT = {
	name: "record_context",
	description:
		"Record what the user asked for, before you commit, so appmarket.org can attach it to the commit as a checkpoint. Call it once before each git commit with the user's request (verbatim where possible) and one sentence on what you changed. Secrets are redacted on this machine before anything is uploaded.",
	inputSchema: {
		type: "object",
		properties: {
			prompt: { type: "string", description: "The user's request that led to this commit." },
			summary: { type: "string", description: "One or two sentences on what you changed." },
		},
		required: ["prompt"],
		additionalProperties: false,
	},
} as const;

interface Request {
	jsonrpc: "2.0";
	id?: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** Handles one JSON-RPC message; returns the response (a promise for tools that call the API), or undefined for notifications. */
export function handle(message: Request, cwd = process.cwd(), now = () => new Date().toISOString()): object | Promise<object> | undefined {
	const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id ?? null, result });
	switch (message.method) {
		case "initialize":
			return reply({
				protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "appmarket", version: VERSION },
			});
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools: [RECORD_CONTEXT, ...PLANE_TOOLS] });
		case "tools/call": {
			const name = message.params?.name;
			const args = (message.params?.arguments ?? {}) as { prompt?: unknown; summary?: unknown };
			// #237: the collaboration plane's tools call appmarket.org.
			if (typeof name === "string" && PLANE_TOOL_NAMES.has(name)) return callPlaneTool(name, args, cwd).then(reply);
			if (name !== RECORD_CONTEXT.name) return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32602, message: `Unknown tool: ${String(name)}` } };
			if (typeof args.prompt !== "string" || !args.prompt.trim()) return reply(text("prompt is required.", true));
			const root = repoRoot(cwd);
			if (!root || !gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root })) return reply(text("This folder is not an appmarket.org repo (run `appmarket init`); nothing recorded."));
			if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return reply(text("Checkpoints are disabled in this repo; nothing recorded."));
			const key = bufferKey(root);
			const ts = now();
			append(key, { v: 1, ts, type: "prompt", harness: "mcp", text: args.prompt.slice(0, 100_000) });
			if (typeof args.summary === "string" && args.summary.trim()) append(key, { v: 1, ts, type: "assistant", harness: "mcp", text: args.summary.slice(0, 10_000) });
			return reply(text("Recorded. Commit when ready; the checkpoint is attached to the next commit."));
		}
		default:
			if (message.id === undefined) return undefined; // notifications/initialized and other notifications
			return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
	}
}

/** `appmarket mcp`: MCP over stdio (newline-delimited JSON-RPC). Logs go to cli.log, never stdout. */
export function mcp(): Promise<number> {
	return new Promise((resolve) => {
		const lines = createInterface({ input: process.stdin });
		lines.on("line", (line) => {
			if (!line.trim()) return;
			try {
				const request = JSON.parse(line) as Request;
				void Promise.resolve(handle(request))
					.then((response) => {
						if (response) process.stdout.write(JSON.stringify(response) + "\n");
					})
					.catch((error: unknown) => {
						log("mcp tool failed", error);
						process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: "Internal error" } }) + "\n");
					});
			} catch (error) {
				log("mcp message failed", error);
				process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
			}
		});
		lines.on("close", () => resolve(0));
	});
}
