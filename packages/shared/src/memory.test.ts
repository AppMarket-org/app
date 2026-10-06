import { describe, expect, it } from "vitest";
import { cleanMemoryTags, MEMORY_LIMITS, parseMemoryInput } from "./memory";

describe("memory input (#194)", () => {
	it("needs text on create and caps its length", () => {
		expect(parseMemoryInput({}, false)).toEqual({ error: "text is required." });
		expect(parseMemoryInput({ text: "x".repeat(MEMORY_LIMITS.text + 1) }, false)).toMatchObject({ error: expect.stringContaining("1000") });
		expect(parseMemoryInput({ text: "  Run pnpm test before pushing.\r\n", tags: ["Testing", "#ci"], source: "claude-code", session: "0f8fad5b-d9cb-469f-a165-70867728950e" }, false)).toEqual({
			text: "Run pnpm test before pushing.",
			tags: ["testing", "ci"],
			source: "claude-code",
			sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
		});
	});

	it("takes only the given fields on update, and refuses empty updates", () => {
		expect(parseMemoryInput({ pinned: true }, true)).toEqual({ pinned: true, source: "web", sessionId: null });
		expect(parseMemoryInput({}, true)).toEqual({ error: "Nothing to change." });
		expect(parseMemoryInput({ pinned: "yes" }, true)).toEqual({ error: "pinned is true or false." });
		expect(parseMemoryInput({ text: "ok", source: "evil" }, true)).toMatchObject({ source: "web" });
	});

	it("cleans tags and limits their number", () => {
		expect(cleanMemoryTags(["a", "A", " b ", "bad tag", "", 3])).toEqual(["a", "b"]);
		expect(cleanMemoryTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toBeNull();
		expect(cleanMemoryTags("x")).toBeNull();
	});
	it("takes public as true or false (#198)", () => {
		expect(parseMemoryInput({ public: true }, true)).toMatchObject({ public: true });
		expect(parseMemoryInput({ public: "yes" }, true)).toHaveProperty("error");
	});
});
