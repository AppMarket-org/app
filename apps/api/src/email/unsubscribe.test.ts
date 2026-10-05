import { describe, expect, it } from "vitest";
import { signUnsubscribe, unsubscribeQuery, verifyUnsubscribe } from "./unsubscribe";

describe("unsubscribe links (#230)", () => {
	it("verifies its own signature only, for that user and topic", async () => {
		const s = await signUnsubscribe("secret", "user-1", "impacts");
		expect(await verifyUnsubscribe("secret", "user-1", "impacts", s)).toBe(true);
		expect(await verifyUnsubscribe("secret", "user-2", "impacts", s)).toBe(false);
		expect(await verifyUnsubscribe("other", "user-1", "impacts", s)).toBe(false);
		expect(await verifyUnsubscribe("secret", "user-1", "marketing", s)).toBe(false);
		expect(await verifyUnsubscribe("secret", "user-1", "impacts", "x")).toBe(false);
		expect(await unsubscribeQuery("secret", "user-1", "impacts")).toBe(`u=user-1&t=impacts&s=${s}`);
	});
});
