import { describe, expect, it } from "vitest";
import { parseIssueInput } from "./issues";

describe("parseIssueInput", () => {
	it("needs a title for a new issue and trims it", () => {
		expect(parseIssueInput({}, false)).toEqual({ error: "A title is required." });
		expect(parseIssueInput({ title: "  Flags on long press  ", type: "bug", priority: "high", assignee: "Agents" }, false)).toEqual({
			title: "Flags on long press",
			type: "bug",
			priority: "high",
			assignee: "agents",
		});
	});

	it("checks only the fields a change gives", () => {
		expect(parseIssueInput({ state: "closed", reason: "not_planned" }, true)).toEqual({ state: "closed", reason: "not_planned" });
		expect(parseIssueInput({ assignee: null }, true)).toEqual({ assignee: null });
	});

	it("refuses unknown values", () => {
		expect(parseIssueInput({ type: "epic" }, true)).toHaveProperty("error");
		expect(parseIssueInput({ priority: "p0" }, true)).toHaveProperty("error");
		expect(parseIssueInput({ assignee: "../x" }, true)).toHaveProperty("error");
		expect(parseIssueInput({ state: "merged" }, true)).toHaveProperty("error");
		expect(parseIssueInput({ title: "x".repeat(201) }, true)).toHaveProperty("error");
	});
});
