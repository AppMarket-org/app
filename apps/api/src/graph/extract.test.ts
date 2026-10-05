import { describe, expect, it } from "vitest";
import { graphEdges, rangeAllows, rangeOverlaps } from "./extract";

describe("graph edges (#67)", () => {
	it("records dependencies with their ranges and bindings by type", () => {
		const pkg = JSON.stringify({ dependencies: { hono: "^4.6.0", "@Scope/Lib": "1.2.3", "bad name!": "1" }, devDependencies: { vitest: "^3" } });
		const edges = graphEdges(pkg, { resources: [{ type: "d1", binding: "DB", name: "x" }, { type: "kv", binding: "CACHE", name: null }], envVars: [], secrets: [] });
		expect(edges).toEqual([
			{ kind: "dependency", target: "hono", detail: "^4.6.0" },
			{ kind: "dependency", target: "@scope/lib", detail: "1.2.3" },
			{ kind: "dev-dependency", target: "vitest", detail: "^3" },
			{ kind: "binding", target: "d1", detail: "DB" },
			{ kind: "binding", target: "kv", detail: "CACHE" },
		]);
		expect(graphEdges("not json", null)).toEqual([]);
	});
});

describe("version ranges (#67)", () => {
	it("matches a version against declared ranges, counting unparseable ones", () => {
		expect(rangeAllows("^4.6.0", "4.7.1")).toBe(true);
		expect(rangeAllows("^4.6.0", "5.0.0")).toBe(false);
		expect(rangeAllows("~1.2.3", "1.2.9")).toBe(true);
		expect(rangeAllows("github:acme/lib", "1.0.0")).toBe(true);
		expect(rangeAllows(null, "1.0.0")).toBe(true);
	});
});

describe("vulnerable range overlap (#69)", () => {
	it("flags declared ranges that can resolve into the vulnerable range", () => {
		expect(rangeOverlaps("^4.6.0", "<4.6.2")).toBe(true);
		expect(rangeOverlaps("^4.6.2", "<4.6.2")).toBe(false);
		expect(rangeOverlaps("~1.2.0", ">=1.3.0 <1.4.0")).toBe(false);
		expect(rangeOverlaps("latest", "<2.0.0")).toBe(true);
		expect(rangeOverlaps("^4", "<4.0.0")).toBe(false);
	});
});
