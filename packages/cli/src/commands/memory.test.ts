import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-memory-"));
const { contextFrom, sessionStartContext, withMemorySection, MEMORY_MARK_START } = await import("./memory.ts");

const note = (text: string, pinned = false, tags: string[] = []) => ({ id: crypto.randomUUID(), text, tags, pinned });

describe("repo memory at session start (#196)", () => {
	it("lists pinned notes first within the size budget, and says how many more there are", () => {
		const notes = [note("Run tests with pnpm test", true, ["testing"]), ...Array.from({ length: 50 }, (_, i) => note(`Recent note ${i} ${"x".repeat(80)}`))];
		const ctx = contextFrom(notes, "dev/app", 1000);
		expect(ctx.length).toBeLessThanOrEqual(1000 + 40);
		expect(ctx).toContain("# Repo memory (dev/app on appmarket.org)");
		expect(ctx.split("\n")[2]).toBe("- (pinned) Run tests with pnpm test [testing]");
		expect(ctx).toMatch(/\(\d+ more notes: memory_recall\)\n$/);
		expect(contextFrom([], "dev/app")).toBe("");
	});

	it("is silent when signed out, offline or outside an appmarket repo", async () => {
		const root = mkdtempSync(join(tmpdir(), "am-memory-repo-"));
		execFileSync("git", ["init", "-q", root]);
		expect(await sessionStartContext(root, { token: async () => "t", call: (async () => ({ notes: [note("x")] })) as never })).toBe("");
		execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
		expect(await sessionStartContext(root, { token: async () => null, call: (async () => ({ notes: [note("x")] })) as never })).toBe("");
		expect(await sessionStartContext(root, { token: async () => "t", call: (async () => { throw new Error("offline"); }) as never })).toBe("");
		expect(await sessionStartContext(root, { token: async () => "t", call: (async () => ({ notes: [note("Use pnpm")] })) as never })).toContain("- Use pnpm");
	});

	it("writes and refreshes one memory section in AGENTS.md, keeping the rest", () => {
		const first = withMemorySection("# Agents\n\nBe kind.\n", [note("Use pnpm")], "dev/app");
		expect(first).toMatch(/^# Agents\n\nBe kind\.\n\n<!-- appmarket:memory -->/);
		const again = withMemorySection(`${first}\nAfter.\n`, [note("Use bun")], "dev/app");
		expect(again.split(MEMORY_MARK_START)).toHaveLength(2);
		expect(again).toContain("- Use bun");
		expect(again).not.toContain("- Use pnpm");
		expect(again).toContain("After.");
	});

	it("adds what the latest sessions did after the memory (#71), each part on its own", async () => {
		const root = mkdtempSync(join(tmpdir(), "am-handoff-"));
		execFileSync("git", ["init", "-q", root]);
		execFileSync("git", ["config", "appmarket.repo", "dev/app"], { cwd: root });
		const session = { sessionId: "s1", harness: "codex", model: "gpt-5", branch: "main", startedAt: "2026-10-06T09:00:00Z", endedAt: "2026-10-06T09:30:00Z", firstPrompt: "Add a timer", lastPrompt: null, summary: "Timer added.", commits: ["a".repeat(40)], files: ["public/game.js"], failedTools: 0 };
		const call = (async (_api: string, path: string) => (path.includes("/handoff") ? { sessions: [session] } : { notes: [note("Use pnpm", true)] })) as never;
		const ctx = await sessionStartContext(root, { token: async () => "t", call });
		expect(ctx.indexOf("# Repo memory")).toBeLessThan(ctx.indexOf("# Recent agent sessions"));
		expect(ctx).toContain("## Codex (gpt-5) on main");
		expect(ctx).toContain("- Asked: Add a timer");
		// The memory still comes when the handoff fails.
		const failing = (async (_api: string, path: string) => {
			if (path.includes("/handoff")) throw new Error("timeout");
			return { notes: [note("Use pnpm")] };
		}) as never;
		expect(await sessionStartContext(root, { token: async () => "t", call: failing })).toContain("- Use pnpm");
	});
});
