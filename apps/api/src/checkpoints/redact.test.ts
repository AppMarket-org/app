import { describe, expect, it } from "vitest";
import { record } from "./fixtures.ts";
import { redactRecord } from "./redact.ts";

describe("redactRecord (#128)", () => {
	it("cleans prompts, the assistant message and tool arguments, and counts", () => {
		const gh = "ghp_" + "x".repeat(36);
		const { record: clean, count } = redactRecord({ ...record(1), assistant_summary: `pushed with ${gh}`, redactions: 1 });
		expect(count).toBe(1);
		expect(clean.assistant_summary).toBe("pushed with [redacted:github]");
		expect(clean.redactions).toBe(2);
		const untouched = record(2);
		expect(redactRecord(untouched)).toEqual({ record: untouched, count: 0 });
	});
});
