import { describe, expect, it } from "vitest";
import { isBranchName, parsePullInput } from "./pulls";

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
});
