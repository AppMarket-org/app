import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editHooks, HOOK_COMMAND } from "../commands/adapter.ts";
import { argsSummary, COMMIT_COMMAND, eventsFor, transcriptEvents } from "./claude-code.ts";

const assistant = (id: string, ts: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		type: "assistant",
		timestamp: ts,
		version: "2.1.287",
		effort: "high",
		message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: `reply ${id}` }], usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 50, output_tokens_details: { thinking_tokens: 30 } } },
		...extra,
	});

describe("Claude Code hook events", () => {
	it("maps prompts and tool calls, with the transcript position", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-cc-"));
		const transcript = join(dir, "t.jsonl");
		writeFileSync(transcript, "x".repeat(42));
		const [prompt] = eventsFor({ hook_event_name: "UserPromptSubmit", session_id: "s", transcript_path: transcript, prompt: "Add tests" });
		expect(prompt).toMatchObject({ type: "prompt", text: "Add tests", session_id: "s", transcript_offset: 42, harness: "claude-code" });
		// Claude Code's own messages (a background command ended) are not prompts.
		expect(eventsFor({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>" })).toEqual([]);
		const [tool] = eventsFor({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm   test" }, tool_response: { interrupted: false } });
		expect(tool).toMatchObject({ type: "tool", name: "Bash", args: "npm test", outcome: "ok" });
		expect(eventsFor({ hook_event_name: "PostToolUseFailure", tool_name: "Edit", tool_input: { file_path: "a.ts" } })[0]).toMatchObject({ outcome: "error", args: "a.ts" });
		expect(eventsFor({ hook_event_name: "Notification" })).toEqual([]);
	});

	it("recognises commit commands", () => {
		expect(COMMIT_COMMAND.test('git add -A && git commit -m "x"')).toBe(true);
		expect(COMMIT_COMMAND.test("git -C repo commit --amend")).toBe(true);
		expect(COMMIT_COMMAND.test("git log --grep commit")).toBe(true); // harmless: checkpoint skips commits that have a note
		expect(COMMIT_COMMAND.test("npm run commitlint")).toBe(false);
		expect(argsSummary("mcp__x__y", { a: 1, b: 2 })).toBe("a,b");
		expect(argsSummary("Write", { file_path: "/work/app/src/a.ts" }, "/work/app")).toBe("src/a.ts");
		expect(argsSummary("Bash", { command: `cat ${homedir()}/notes.txt` })).toBe("cat ~/notes.txt");
	});
});

describe("transcriptEvents", () => {
	it("counts each message once, stops at the commit, starts at the offset", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-cc-"));
		const path = join(dir, "t.jsonl");
		writeFileSync(path, assistant("m0", "2026-10-03T09:00:00.000Z") + "\n");
		const offset = statSync(path).size;
		writeFileSync(
			path,
			[
				assistant("m0", "2026-10-03T09:00:00.000Z"),
				JSON.stringify({ type: "user", timestamp: "2026-10-03T10:00:00.000Z" }),
				assistant("m1", "2026-10-03T10:00:01.000Z"),
				assistant("m1", "2026-10-03T10:00:02.000Z"),
				assistant("m2", "2026-10-03T10:00:03.000Z", { isSidechain: true }),
				assistant("m3", "2026-10-03T11:00:00.000Z"),
			].join("\n") + "\n",
		);
		const events = transcriptEvents(path, offset, "2026-10-03T10:30:00.000Z");
		const usage = events.filter((e) => e.type === "usage");
		expect(usage).toHaveLength(2);
		expect(usage[0]).toMatchObject({ input_tokens: 112, output_tokens: 50, reasoning_tokens: 30 });
		expect(events.find((e) => e.type === "settings")).toMatchObject({ model: "claude-opus-5-5", effort: "high", harness_version: "2.1.287" });
		// The subagent's text is not the session's summary.
		expect(events.find((e) => e.type === "assistant")?.text).toBe("reply m1");
		// A session that ended before this window (only its SessionEnd is in it) contributes nothing.
		expect(transcriptEvents(path, 0, "2026-10-03T12:00:00.000Z", "2026-10-03T11:30:00.000Z")).toEqual([]);
	});
});

describe("adapter install", () => {
	it("adds its hooks once and removes only its own", () => {
		const user = { model: "opus", hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "/usr/local/bin/status" }] }] } };
		const once = editHooks(user, true);
		const twice = editHooks(once, true);
		expect(twice).toEqual(once);
		expect(once.hooks!.PostToolUse).toHaveLength(2);
		expect(once.hooks!.UserPromptSubmit![0]!.hooks[0]!.command).toBe(HOOK_COMMAND);
		expect(editHooks(once, false)).toEqual(user);
	});
});
