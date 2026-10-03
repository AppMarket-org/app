import { describe, expect, it } from "vitest";
import { buildSearchWhere, escapeLike } from "./search.ts";

describe("escapeLike", () => {
	it("escapes LIKE wildcards and the escape character", () => {
		expect(escapeLike(String.raw`50%_off\now`)).toBe(String.raw`50\%\_off\\now`);
	});
});

describe("buildSearchWhere", () => {
	it("always restricts to published repos", () => {
		expect(buildSearchWhere({})).toEqual({ where: "l.state = 'published'", params: [] });
	});

	it("adds a literal name/summary match and a category filter", () => {
		const { where, params } = buildSearchWhere({ q: "100%", category: "ai" });
		expect(where).toContain("l.name LIKE ? ESCAPE");
		expect(where).toContain("l.category = ?");
		expect(params).toEqual([String.raw`%100\%%`, String.raw`%100\%%`, "ai"]);
	});
});
