import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { editOpencodeConfig, OPENCODE_PLUGIN, opencodeEvents, type OpencodeInput } from "./opencode.ts";

const TS = "2026-10-06T20:00:00.000Z";

describe("OpenCode adapter (#119)", () => {
	it("turns the plugin's events into buffer events", () => {
		const root = "/work/app";
		const at = (input: OpencodeInput) => opencodeEvents({ ts: TS, sessionID: "ses_1", ...input }, root);
		expect(at({ event: "prompt", text: "Add a login page", model: "claude-sonnet-5-5", effort: "high" })).toEqual([
			{ v: 1, ts: TS, harness: "opencode", session_id: "ses_1", type: "prompt", text: "Add a login page" },
			{ v: 1, ts: TS, harness: "opencode", session_id: "ses_1", type: "settings", model: "claude-sonnet-5-5", effort: "high", harness_version: undefined },
		]);
		expect(at({ event: "prompt", text: "" })).toEqual([]);
		// OpenCode's input excludes cached tokens; the record's input_tokens includes them.
		expect(at({ event: "usage", tokens: { input: 100, output: 40, reasoning: 12, cache: { read: 900, write: 50 } }, cost: 0.0123 })[0]).toMatchObject({
			type: "usage",
			input_tokens: 1050,
			output_tokens: 40,
			reasoning_tokens: 12,
			cache_read_tokens: 900,
			cache_write_tokens: 50,
			cost_usd: 0.0123,
		});
		// OpenCode's tools name files filePath; paths become repo-relative.
		expect(at({ event: "tool", tool: "edit", args: { filePath: "/work/app/src/login.ts", oldString: "a", newString: "b" } })[0]).toMatchObject({ type: "tool", name: "edit", args: "src/login.ts", outcome: "ok" });
		expect(at({ event: "tool", tool: "bash", args: { command: "pnpm test" }, error: true })[0]).toMatchObject({ name: "bash", args: "pnpm test", outcome: "error" });
		expect(at({ event: "settings", model: "gpt-6.1-sol", version: "1.18.35" })[0]).toMatchObject({ type: "settings", model: "gpt-6.1-sol", harness_version: "1.18.35" });
		expect(at({ event: "assistant", text: "Done: login page added." })[0]).toMatchObject({ type: "assistant", text: "Done: login page added." });
		expect(at({ event: "session.start" })[0]).toMatchObject({ type: "session.start", session_id: "ses_1" });
		expect(at({ event: "nonsense" as OpencodeInput["event"] })).toEqual([]);
	});

	it("adds and removes only its own MCP server in opencode.json", () => {
		const config = { $schema: "https://opencode.ai/config.json", mcp: { other: { type: "remote", url: "https://example.test/mcp" } } };
		const installed = editOpencodeConfig(config, true);
		expect(installed.mcp).toEqual({ other: config.mcp.other, appmarket: { type: "local", command: ["appmarket", "mcp"], enabled: true } });
		expect(editOpencodeConfig(installed, true)).toEqual(installed);
		expect(editOpencodeConfig(installed, false)).toEqual(config);
		expect(editOpencodeConfig({ theme: "dark" }, false)).toEqual({ theme: "dark" });
	});

	it("the plugin forwards prompts, tools, model, usage and the final answer without waiting, and skips subagent prompts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "am-opencode-"));
		const out = join(dir, "events");
		mkdirSync(out);
		// A stand-in `appmarket` that stores what it is sent, one file per call.
		const bin = join(dir, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "appmarket"), `#!/bin/sh\ncat > "${out}/$$.json"\n`);
		chmodSync(join(bin, "appmarket"), 0o755);
		const file = join(dir, "appmarket.mjs");
		writeFileSync(file, OPENCODE_PLUGIN);
		const path = process.env.PATH;
		process.env.PATH = `${bin}:${path}`;
		try {
			const { AppmarketPlugin } = (await import(pathToFileURL(file).href)) as { AppmarketPlugin: (ctx: { directory: string }) => Promise<Record<string, (...a: unknown[]) => Promise<void>>> };
			const hooks = await AppmarketPlugin({ directory: "/work/app" });
			const event = (type: string, properties: object) => hooks.event!({ event: { type, properties } });
			await event("session.created", { info: { id: "ses_1", directory: "/work/app" } });
			await event("session.created", { info: { id: "ses_sub", parentID: "ses_1" } });
			await hooks["chat.message"]!({ sessionID: "ses_1", model: { providerID: "anthropic", modelID: "claude-sonnet-5-5" }, variant: "high" }, { parts: [{ type: "text", text: "Add a login page" }, { type: "text", text: "<file>", synthetic: true }] });
			await hooks["chat.message"]!({ sessionID: "ses_sub" }, { parts: [{ type: "text", text: "subagent task" }] });
			const message = { id: "msg_1", sessionID: "ses_1", role: "assistant", modelID: "claude-sonnet-5-5", time: { created: 1 } };
			await event("message.updated", { info: message });
			await event("message.updated", { info: message });
			const tool = { id: "prt_t", sessionID: "ses_1", messageID: "msg_1", type: "tool", callID: "call_1", tool: "bash" };
			await event("message.part.updated", { part: { ...tool, state: { status: "running", input: { command: "git commit -m x" } } } });
			await event("message.part.updated", { part: { ...tool, state: { status: "completed", input: { command: "git commit -m x" }, output: "" } } });
			await event("message.part.updated", { part: { ...tool, state: { status: "completed", input: { command: "git commit -m x" }, output: "" } } });
			await event("message.part.updated", { part: { id: "prt_s", sessionID: "ses_1", messageID: "msg_1", type: "step-finish", cost: 0.01, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 100, write: 0 } } } });
			await event("message.part.updated", { part: { id: "prt_x", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "Done." } });
			await event("message.updated", { info: { ...message, time: { created: 1, completed: 2 } } });
			const want = 6; // session.start, prompt, settings, tool, usage, assistant
			for (let i = 0; i < 100 && readdirSync(out).length < want; i++) await new Promise((r) => setTimeout(r, 50));
			await new Promise((r) => setTimeout(r, 100));
			const sent = readdirSync(out).map((f) => JSON.parse(readFileSync(join(out, f), "utf8")) as OpencodeInput & { event: string });
			expect(sent.map((e) => e.event).sort()).toEqual(["assistant", "prompt", "session.start", "settings", "tool", "usage"]);
			expect(sent.every((e) => e.directory === "/work/app" && typeof e.ts === "string")).toBe(true);
			expect(sent.find((e) => e.event === "prompt")).toMatchObject({ sessionID: "ses_1", text: "Add a login page", model: "claude-sonnet-5-5", effort: "high" });
			expect(sent.find((e) => e.event === "tool")).toMatchObject({ tool: "bash", args: { command: "git commit -m x" }, error: false });
			expect(sent.find((e) => e.event === "usage")).toMatchObject({ tokens: { input: 10, cache: { read: 100 } }, cost: 0.01 });
			expect(sent.find((e) => e.event === "assistant")).toMatchObject({ text: "Done." });
		} finally {
			process.env.PATH = path;
		}
	});

	it("without the CLI on PATH the plugin does nothing and does not throw", async () => {
		const dir = mkdtempSync(join(tmpdir(), "am-opencode-"));
		const file = join(dir, "appmarket.mjs");
		writeFileSync(file, OPENCODE_PLUGIN);
		const path = process.env.PATH;
		process.env.PATH = join(dir, "empty");
		try {
			const { AppmarketPlugin } = (await import(pathToFileURL(file).href)) as { AppmarketPlugin: (ctx: { directory: string }) => Promise<Record<string, (...a: unknown[]) => Promise<void>>> };
			const hooks = await AppmarketPlugin({ directory: dir });
			await hooks["chat.message"]!({ sessionID: "s" }, { parts: [{ type: "text", text: "hi" }] });
			await hooks.event!({ event: { type: "message.part.updated", properties: { part: null } } });
			await new Promise((r) => setTimeout(r, 100));
		} finally {
			process.env.PATH = path;
		}
	});

	it("`appmarket hook opencode` records only in an initialised repo", async () => {
		const home = mkdtempSync(join(tmpdir(), "am-home-"));
		process.env.APPMARKET_HOME = home;
		const { hook } = await import("../commands/hook.ts");
		const repo = mkdtempSync(join(tmpdir(), "am-repo-"));
		execFileSync("git", ["init", "-q", repo]);
		const send = (directory: string) => hook("opencode", JSON.stringify({ event: "prompt", directory, sessionID: "ses_1", text: "Add a login page", model: "m" }));
		expect(await send(repo)).toBe(0);
		expect(existsSync(join(home, "sessions"))).toBe(false);
		execFileSync("git", ["-C", repo, "config", "appmarket.repo", "dev/app"]);
		expect(await send(repo)).toBe(0);
		const buffer = readFileSync(join(home, "sessions", "dev__app.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; harness: string });
		expect(buffer.map((e) => `${e.harness}:${e.type}`)).toEqual(["opencode:prompt", "opencode:settings"]);
		expect(await hook("opencode", "not json")).toBe(0);
	});
});
