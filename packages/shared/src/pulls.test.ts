import { describe, expect, it } from "vitest";
import { isBranchName, parsePullInput, reviewDecision } from "./pulls";

describe("pull request input (#256)", () => {
	it("accepts ordinary branch names and refuses tricky ones", () => {
		for (const ok of ["main", "feature/login", "agent/dark-mode", "v1.2", "fix_x-y"]) expect(isBranchName(ok), ok).toBe(true);
		for (const bad of ["", "-x", "a..b", "a//b", "a/", "x.lock", "a b", "a\u0000", 3]) expect(isBranchName(bad), String(bad)).toBe(false);
	});

	it("needs a title on create; takes only given fields on update", () => {
		expect(parsePullInput({}, false)).toEqual({ error: "A title is required." });
		expect(parsePullInput({ title: " Add login ", body: " Details " }, false)).toEqual({ title: "Add login", body: "Details" });
		expect(parsePullInput({ body: "x" }, true)).toEqual({ body: "x" });
		expect(parsePullInput({ title: "x".repeat(201) }, true)).toMatchObject({ error: expect.stringContaining("200") });
	});

	it("decides from each counting reviewer's latest review (#258)", () => {
		const r = (reviewerId: string, state: "commented" | "approved" | "changes_requested", createdAt: string, counts = true) => ({ reviewerId, state, counts, createdAt });
		expect(reviewDecision([])).toEqual({ decision: null, approvals: 0 });
		expect(reviewDecision([r("a", "approved", "1"), r("b", "commented", "2")])).toEqual({ decision: "approved", approvals: 1 });
		expect(reviewDecision([r("a", "approved", "1"), r("b", "changes_requested", "2")])).toEqual({ decision: "changes_requested", approvals: 1 });
		// b approves after asking for changes; a comment does not undo an approval; outsiders do not count.
		expect(reviewDecision([r("b", "changes_requested", "1"), r("b", "approved", "2"), r("b", "commented", "3"), r("x", "changes_requested", "4", false)])).toEqual({ decision: "approved", approvals: 1 });
	});
});
