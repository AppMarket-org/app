import type { Checkpoint } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { commitEntries } from "./commits.ts";

const commit = (hash: string, message: string, authoredAt: number) => ({ hash, treeHash: "t", message, author: { name: "Chris", email: "c@example.test" }, committer: { name: "Chris", email: "c@example.test" }, authoredAt, committedAt: authoredAt, parents: [] }) as unknown as ArtifactsCommitMetadata;

describe("commitEntries", () => {
	it("gives each commit its title, author and date, and the prompts behind it when its checkpoint is visible", () => {
		const prompts = ["Add a daily board", "x".repeat(500), "Make it faster", "Fix the timer"].map((text) => ({ ts: "", text }));
		const cp = { commit: "a".repeat(40), harness: "claude-code", model: "claude-opus-5-5", visibility: "listing", prompts } as unknown as Checkpoint;
		const entries = commitEntries([commit("a".repeat(40), "Daily board\n\nDetails here", 1791300000), commit("b".repeat(40), "Manual fix", 1791300000000)], new Map([["a".repeat(40), cp]]));
		expect(entries[0]).toMatchObject({ sha: "a".repeat(40), title: "Daily board", author: { name: "Chris" }, date: "2026-10-06T15:20:00.000Z", checkpoint: { harness: "claude-code", model: "claude-opus-5-5", promptCount: 4 } });
		expect(entries[0]!.checkpoint!.prompts).toHaveLength(3);
		expect(entries[0]!.checkpoint!.prompts[1]).toBe(`${"x".repeat(400)}…`);
		// No visible checkpoint (none recorded, or private to someone else): no prompts.
		expect(entries[1]).toMatchObject({ title: "Manual fix", date: "2026-10-06T15:20:00.000Z", checkpoint: null });
	});
});
