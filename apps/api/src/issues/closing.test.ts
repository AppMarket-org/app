import { describe, expect, it } from "vitest";
import { closingNumbers } from "./closing.ts";

describe("closingNumbers", () => {
	it("finds the issues a pull request closes", () => {
		expect(closingNumbers("Fixes #3")).toEqual([3]);
		expect(closingNumbers("This closes #4 and resolves: #5.\nAlso fixed #4")).toEqual([4, 5]);
		expect(closingNumbers("Close #12, Resolved #13")).toEqual([12, 13]);
	});

	it("ignores mentions that do not close", () => {
		expect(closingNumbers("See #3, related to #4")).toEqual([]);
		expect(closingNumbers("prefixes #3")).toEqual([]);
		expect(closingNumbers("fixes#3")).toEqual([]);
	});
});
