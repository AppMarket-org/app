import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editHooks, hookCommand } from "../commands/adapter.ts";
import { argsSummary } from "./claude-code.ts";
import { codexTranscriptEvents } from "./codex.ts";

const line = (o: object) => JSON.stringify(o);
const tokens = (ts: string, total: number, input: number, output: number, reasoning: number) =>
	line({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, output_tokens: output, reasoning_output_tokens: reasoning } } } });

describe("Codex rollout", () => {
	it("reads version, model, effort, usage (each call once) and the final answer in the window", () => {
		const path = join(mkdtempSync(join(tmpdir(), "am-codex-")), "rollout.jsonl");
		const head = line({ timestamp: "2026-10-04T09:00:00Z", type: "session_meta", payload: { cli_version: "0.159.3", base_instructions: { text: "x".repeat(5000) } } }) + "\n";
		writeFileSync(path, head + tokens("2026-10-04T09:00:01Z", 50, 50, 0, 0) + "\n");
		const offset = statSync(path).size;
		writeFileSync(
			path,
			head +
				tokens("2026-10-04T09:00:01Z", 50, 50, 0, 0) +
				"\n" +
				[
					line({ timestamp: "2026-10-04T10:00:00Z", type: "turn_context", payload: { model: "gpt-6.1-sol", effort: "xhigh" } }),
					tokens("2026-10-04T10:00:02Z", 1100, 1000, 40, 10),
					tokens("2026-10-04T10:00:02Z", 1100, 1000, 40, 10),
					tokens("2026-10-04T10:00:03Z", 2300, 1150, 50, 0),
					line({ timestamp: "2026-10-04T10:00:04Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done." }] } }),
					tokens("2026-10-04T11:00:00Z", 9999, 5000, 5, 5),
				].join("\n") +
				"\n",
		);
		const events = codexTranscriptEvents(path, offset, "2026-10-04T10:30:00Z", "2026-10-04T09:59:00Z");
		expect(events.filter((e) => e.type === "usage").map((e) => [e.input_tokens, e.output_tokens, e.reasoning_tokens])).toEqual([
			[1000, 40, 10],
			[1150, 50, 0],
		]);
		expect(events.find((e) => e.type === "settings")).toMatchObject({ harness: "codex", model: "gpt-6.1-sol", effort: "xhigh", harness_version: "0.159.3" });
		expect(events.find((e) => e.type === "assistant")?.text).toBe("Done.");
		// turn_context is written before the first hook fires: still found when it precedes the window.
		const later = codexTranscriptEvents(path, offset, "2026-10-04T10:30:00Z", "2026-10-04T10:00:03Z");
		expect(later.find((e) => e.type === "settings")).toMatchObject({ model: "gpt-6.1-sol", effort: "xhigh" });
	});

	it("summarises apply_patch as the files it touches, relative to the repo", () => {
		const patch = "*** Begin Patch\n*** Add File: /work/app/r.txt\n+r\n*** Update File: /work/app/src/a.ts\n@@\n-x\n+y\n*** End Patch";
		expect(argsSummary("apply_patch", { command: patch }, "/work/app")).toBe("r.txt, src/a.ts");
	});

	it("installs its hooks in Codex's hooks.json alongside others", () => {
		const theirs = { hooks: { Stop: [{ hooks: [{ type: "command", command: "notify-me" }] }] } };
		const installed = editHooks(theirs, true, "codex");
		expect(Object.keys(installed.hooks!).sort()).toEqual(["PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
		expect(installed.hooks!.PostToolUse![0]).toMatchObject({ matcher: ".*", hooks: [{ command: hookCommand("codex") }] });
		expect(editHooks(installed, false, "codex")).toEqual(theirs);
		// Claude Code's hooks are a different set; removing those leaves Codex's alone.
		expect(editHooks(installed, false, "claude-code")).toEqual(installed);
	});
});
