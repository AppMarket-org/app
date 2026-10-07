import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("final replies as checkpoint summaries", () => {
	it("replaces the summary of the session's commits with its final reply, redacted, in the note and a forced upload", async () => {
		const home = mkdtempSync(join(tmpdir(), "am-home-"));
		process.env.APPMARKET_HOME = home;
		const { awaitSummary, finishSummaries } = await import("./summaries.ts");
		const { lastReply } = await import("./adapters/claude-code.ts");
		const repo = mkdtempSync(join(tmpdir(), "am-repo-"));
		const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
		g("init", "-q");
		g("config", "user.email", "dev@example.test");
		g("config", "user.name", "Dev");
		g("config", "appmarket.repo", "dev/app");
		g("config", "appmarket.api", "https://appmarket.example");
		writeFileSync(join(repo, "a.txt"), "a");
		g("add", "a.txt");
		g("commit", "-qm", "First");
		const sha = g("rev-parse", "HEAD");
		const record = { schema: "appmarket.checkpoint/1", commit: sha, session_id: "s1", harness: "claude-code", assistant_summary: "Now a test:", redactions: 0, prompts: [] };
		execFileSync("git", ["-C", repo, "notes", "--ref=appmarket", "add", "-F", "-", sha], { input: JSON.stringify(record) });
		awaitSummary(repo, "s1", sha);

		// Another session's end changes nothing; an empty reply neither.
		expect(finishSummaries(repo, "s2", "Done.", { sync: false })).toBe(0);
		expect(finishSummaries(repo, "s1", "  ", { sync: false })).toBe(0);
		expect(finishSummaries(repo, "s1", "Paused the timer while the tab is hidden. Key sk-ant-api03-" + "x".repeat(90), { sync: false })).toBe(1);
		const note = JSON.parse(g("notes", "--ref=appmarket", "show", sha)) as { assistant_summary: string; redactions: number };
		expect(note.assistant_summary).toMatch(/^Paused the timer while the tab is hidden\. Key \[redacted:/);
		expect(note.redactions).toBe(1);
		const queued = readdirSync(join(home, "queue")).map((f) => JSON.parse(readFileSync(join(home, "queue", f), "utf8")) as { force?: boolean; record: { assistant_summary: string } });
		expect(queued).toHaveLength(1);
		expect(queued[0]).toMatchObject({ force: true, record: { assistant_summary: note.assistant_summary } });
		// Done once: the next end of turn has nothing left to update.
		expect(finishSummaries(repo, "s1", "Something else.", { sync: false })).toBe(0);

		// The final reply is the main conversation's last text, not a subagent's.
		const transcript = join(home, "t.jsonl");
		const line = (o: object) => JSON.stringify(o);
		writeFileSync(
			transcript,
			[
				line({ type: "assistant", message: { content: [{ type: "text", text: "Now a test:" }] } }),
				line({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "subagent notes" }] } }),
				line({ type: "assistant", message: { content: [{ type: "tool_use" }, { type: "text", text: "Paused the timer." }] } }),
				line({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "late subagent" }] } }),
			].join("\n"),
		);
		expect(lastReply(transcript)).toBe("Paused the timer.");
		expect(lastReply(undefined)).toBe("");
	});
});
