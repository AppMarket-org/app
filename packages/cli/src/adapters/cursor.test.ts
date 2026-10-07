import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "../commands/adapter.ts";
import { cursorCommitted, cursorDirectory, cursorEvents, editCursorHooks, type CursorInput } from "./cursor.ts";

const TS = "2026-10-06T21:00:00.000Z";
const common = { conversation_id: "conv_1", generation_id: "gen_1", model: "claude-sonnet-5-5", model_params: [{ id: "reasoning_effort", value: "high" }], cursor_version: "3.1.4", workspace_roots: ["/work/app"], user_email: null, transcript_path: null };

describe("Cursor adapter (#120)", () => {
	it("turns hook input into buffer events, with model, effort and Cursor's version", () => {
		const at = (input: Partial<CursorInput> & { hook_event_name: string }) => cursorEvents({ ...common, ...input }, "/work/app", TS);
		const settings = { v: 1, ts: TS, harness: "cursor", session_id: "conv_1", type: "settings", model: "claude-sonnet-5-5", effort: "high", harness_version: "3.1.4" };
		expect(at({ hook_event_name: "beforeSubmitPrompt", prompt: "Add a login page" })).toEqual([{ v: 1, ts: TS, harness: "cursor", session_id: "conv_1", type: "prompt", text: "Add a login page" }, settings]);
		expect(at({ hook_event_name: "beforeSubmitPrompt", prompt: "" })).toEqual([]);
		expect(at({ hook_event_name: "postToolUse", tool_name: "Edit", tool_input: { file_path: "/work/app/src/login.ts" } })).toEqual([{ v: 1, ts: TS, harness: "cursor", session_id: "conv_1", type: "tool", name: "Edit", args: "src/login.ts", outcome: "ok" }]);
		// MCP tools send their input as a JSON string.
		expect(at({ hook_event_name: "postToolUseFailure", tool_name: "Shell", tool_input: JSON.stringify({ command: "pnpm test" }) })[0]).toMatchObject({ name: "Shell", args: "pnpm test", outcome: "error" });
		expect(at({ hook_event_name: "afterAgentResponse", text: "Done." })[0]).toMatchObject({ type: "assistant", text: "Done." });
		expect(at({ hook_event_name: "sessionStart" })[0]).toMatchObject({ type: "session.start", model: "claude-sonnet-5-5" });
		expect(at({ hook_event_name: "sessionEnd" })).toEqual([{ v: 1, ts: TS, harness: "cursor", session_id: "conv_1", type: "session.end" }]);
		expect(at({ hook_event_name: "stop" })).toEqual([]);
		// model_id wins over the display name; no effort setting → none.
		expect(cursorEvents({ hook_event_name: "beforeSubmitPrompt", prompt: "x", model: "Auto", model_id: "gpt-6.1-sol" }, undefined, TS)[1]).toMatchObject({ model: "gpt-6.1-sol", effort: undefined });
	});

	it("spots an agent's git commit and the repo it ran in", () => {
		expect(cursorCommitted({ hook_event_name: "postToolUse", tool_name: "Shell", tool_input: { command: 'git commit -m "Login page"' } })).toBe(true);
		expect(cursorCommitted({ hook_event_name: "postToolUse", tool_name: "Shell", tool_input: { command: "git status" } })).toBe(false);
		expect(cursorCommitted({ hook_event_name: "postToolUseFailure", tool_name: "Shell", tool_input: { command: "git commit -m x" } })).toBe(false);
		expect(cursorDirectory({ hook_event_name: "postToolUse", cwd: "/work/app/sub", workspace_roots: ["/work/app"] })).toBe("/work/app/sub");
		expect(cursorDirectory({ hook_event_name: "beforeSubmitPrompt", workspace_roots: ["/work/app", "/work/other"] })).toBe("/work/app");
	});

	it("adds and removes only its own hooks in hooks.json", () => {
		const theirs = { version: 1, hooks: { afterFileEdit: [{ command: "./format.sh" }], stop: [{ command: "./notify.sh" }] } };
		const installed = editCursorHooks(theirs, true, hookCommand("cursor"));
		expect(installed.hooks!.beforeSubmitPrompt).toEqual([{ command: hookCommand("cursor"), timeout: 10 }]);
		expect(installed.hooks!.afterFileEdit).toEqual(theirs.hooks.afterFileEdit);
		expect(editCursorHooks(installed, true, hookCommand("cursor"))).toEqual(installed);
		expect(editCursorHooks(installed, false, hookCommand("cursor"))).toEqual(theirs);
		expect(editCursorHooks({}, true, hookCommand("cursor")).version).toBe(1);
	});

	it("`appmarket hook cursor` records only in an initialised repo and always lets the prompt through", async () => {
		const home = mkdtempSync(join(tmpdir(), "am-home-"));
		process.env.APPMARKET_HOME = home;
		const { hook } = await import("../commands/hook.ts");
		const repo = mkdtempSync(join(tmpdir(), "am-repo-"));
		execFileSync("git", ["init", "-q", repo]);
		const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			const prompt = () => hook("cursor", JSON.stringify({ ...common, workspace_roots: [repo], hook_event_name: "beforeSubmitPrompt", prompt: "Add a login page" }));
			expect(await prompt()).toBe(0);
			expect(existsSync(join(home, "sessions"))).toBe(false);
			execFileSync("git", ["-C", repo, "config", "appmarket.repo", "dev/app"]);
			expect(await prompt()).toBe(0);
			expect(out.mock.calls.map((c) => String(c[0]))).toEqual(['{"continue":true}\n', '{"continue":true}\n']);
			const buffer = readFileSync(join(home, "sessions", readdirSync(join(home, "sessions")).find((f) => /^dev__app__[0-9a-f]{8}\.jsonl$/.test(f))!), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; harness: string });
			expect(buffer.map((e) => `${e.harness}:${e.type}`)).toEqual(["cursor:prompt", "cursor:settings"]);
			expect(await hook("cursor", "not json")).toBe(0);
		} finally {
			out.mockRestore();
		}
	});
});
