import { describe, expect, it } from "vitest";
import { canTransition, listingInputSchema, listingSearchSchema, slugify } from "./listing";

describe("slugify", () => {
	it.each([
		["My Cool App!", "my-cool-app"],
		["  Café   Déjà Vu ", "cafe-deja-vu"],
		["***", "app"],
		["a".repeat(70), "a".repeat(60)],
	])("%s -> %s", (name, slug) => expect(slugify(name)).toBe(slug));
});

describe("listingInputSchema", () => {
	it("accepts a valid listing and defaults description", () => {
		const parsed = listingInputSchema.parse({ name: "My App", summary: "Does useful things", category: "ai" });
		expect(parsed.description).toBe("");
	});

	it("rejects unknown categories and short names", () => {
		expect(listingInputSchema.safeParse({ name: "x", summary: "Does useful things", category: "nope" }).success).toBe(false);
	});
});

describe("listingSearchSchema", () => {
	it("coerces paging and caps page size", () => {
		expect(listingSearchSchema.parse({ page: "2" })).toMatchObject({ page: 2, pageSize: 20 });
		expect(listingSearchSchema.safeParse({ pageSize: "500" }).success).toBe(false);
	});
});

describe("canTransition", () => {
	it("allows publish only from submitted", () => {
		expect(canTransition("submitted", "published")).toBe(true);
		expect(canTransition("draft", "published")).toBe(false);
	});
});
