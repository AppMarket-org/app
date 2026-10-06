import { describe, expect, it } from "vitest";
import { claimProblem, cleanTags, leaseConflicts, leaseHints, normalizePath, type PlaneAgent, type PlaneTask, pathsOverlap } from "./model";

const task = (o: Partial<PlaneTask> = {}): PlaneTask => ({ id: "t1", title: "T", description: "", capabilities: ["typescript"], status: "open", claimedBy: null, branch: null, note: null, issue: null, merge: null, createdAt: "", updatedAt: "", ...o });
const agent = (o: Partial<PlaneAgent> = {}): PlaneAgent => ({ id: "a1", name: "Claude", vendor: "anthropic", capabilities: ["typescript", "frontend"], lastSeen: "", ...o });

describe("collaboration plane rules (#236)", () => {
	it("normalizes lease paths and refuses escapes and globs", () => {
		expect(normalizePath("./src/auth/")).toBe("src/auth/");
		expect(normalizePath("/src//a.ts")).toBe("src/a.ts");
		for (const bad of ["", "../x", "src/../x", "src/*.ts", "a\0b"]) expect(normalizePath(bad), bad).toBeNull();
	});

	it("treats directories as covering what is below them", () => {
		expect(pathsOverlap("src/", "src/a.ts")).toBe(true);
		expect(pathsOverlap("src/a.ts", "src/")).toBe(true);
		expect(pathsOverlap("src/a.ts", "src/a.ts")).toBe(true);
		expect(pathsOverlap("src/a.ts", "src/ab.ts")).toBe(false);
		expect(pathsOverlap("src", "srcx/a.ts")).toBe(false);
		expect(pathsOverlap("src/auth", "src/auth/login.ts")).toBe(true);
	});

	it("finds conflicting leases of other agents only, ignoring expired ones", () => {
		const leases = [
			{ agentId: "a2", taskId: null, path: "src/auth/", expiresAt: 2000 },
			{ agentId: "a2", taskId: null, path: "README.md", expiresAt: 500 },
			{ agentId: "a1", taskId: null, path: "src/ui/", expiresAt: 2000 },
		];
		expect(leaseConflicts(leases, "a1", ["src/auth/login.ts", "README.md", "src/ui/x.ts"], 1000).map((l) => l.path)).toEqual(["src/auth/"]);
	});

	it("lets an agent claim an open task it has the capabilities for", () => {
		expect(claimProblem(task(), agent())).toBeNull();
		expect(claimProblem(task({ status: "claimed" }), agent())).toMatch(/claimed/);
		expect(claimProblem(task({ capabilities: ["rust"] }), agent())).toMatch(/rust/);
		expect(claimProblem(task(), undefined)).toMatch(/Register/);
		expect(cleanTags(["TypeScript", "front end", "c++", 3])).toEqual(["typescript", "c++"]);
	});

	it("hints when a leased file imports or is imported by another agent's leased file (#240)", () => {
		const neighbours = new Map([
			["src/api.ts", [{ other: "src/db/store.ts", relation: "imports" as const }, { other: "src/ui/page.ts", relation: "imported by" as const }]],
			["src/util.ts", [{ other: "src/mine.ts", relation: "imported by" as const }]],
		]);
		const leases = [
			{ agentId: "a2", taskId: null, path: "src/db/", expiresAt: 2000 },
			{ agentId: "a2", taskId: null, path: "src/ui/page.ts", expiresAt: 500 },
			{ agentId: "a1", taskId: null, path: "src/mine.ts", expiresAt: 2000 },
		];
		expect(leaseHints(neighbours, leases, "a1", 1000)).toEqual([{ path: "src/api.ts", related: "src/db/store.ts", relation: "imports", agentId: "a2", lease: "src/db/" }]);
	});
});
