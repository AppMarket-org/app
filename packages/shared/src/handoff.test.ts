import { describe, expect, it } from "vitest";
import { handoffText, summarizeSessions } from "./handoff";

const rec = (commit: string, session: string, at: string, prompt: string, extra: Partial<{ harness: string; summary: string; failed: number; files: string[] }> = {}) => ({
	commit: commit.padEnd(40, "0"),
	session_id: session,
	harness: (extra.harness ?? "claude-code") as "claude-code",
	model: "claude-opus-5-5",
	branch: "main",
	prompts: [{ ts: at, text: prompt }],
	assistant_summary: extra.summary ?? "",
	files: (extra.files ?? ["public/game.js"]).map((path) => ({ path, added: 1, removed: 0 })),
	tools: Array.from({ length: extra.failed ?? 0 }, () => ({ name: "Bash", args_summary: "npm test", outcome: "error" as const, ts: at })),
	created_at: at,
});

describe("session handoff (#71)", () => {
	it("groups checkpoints into sessions, newest first, with first and last requests", () => {
		const sessions = summarizeSessions([
			rec("a1", "s1", "2026-10-05T10:00:00Z", "Add a share button"),
			rec("a2", "s1", "2026-10-05T10:30:00Z", "Also copy the time to the clipboard", { summary: "Share button with clipboard fallback.", failed: 2 }),
			rec("b1", "s2", "2026-10-06T09:00:00Z", "Bombs left in the tab title", { harness: "codex", files: ["public/game.js", "public/index.html"] }),
		]);
		expect(sessions.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
		expect(sessions[1]).toMatchObject({ firstPrompt: "Add a share button", lastPrompt: "Also copy the time to the clipboard", summary: "Share button with clipboard fallback.", failedTools: 2 });
		expect(sessions[1]!.commits.map((c) => c.slice(0, 2))).toEqual(["a2", "a1"]);
	});

	it("renders a handoff within the budget, newest session first", () => {
		const sessions = summarizeSessions([rec("a1", "s1", "2026-10-05T10:00:00Z", "Add a share button", { summary: "Done." }), rec("b1", "s2", "2026-10-06T09:00:00Z", "Tab title", { harness: "codex" })]);
		const text = handoffText(sessions);
		expect(text).toMatch(/^# Recent agent sessions in this repo\n/);
		expect(text.indexOf("## Codex")).toBeLessThan(text.indexOf("## Claude Code"));
		expect(text).toContain("- Asked: Add a share button\n- Result: Done.\n- Commits: a100000; files: public/game.js");
		expect(handoffText(sessions, 250)).not.toContain("## Claude Code");
		expect(handoffText([])).toBe("");
	});
});
