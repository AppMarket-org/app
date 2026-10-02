import { describe, expect, it } from "vitest";
import { canTransition, listingInputSchema, listingSearchSchema, slugify, transitionSchema } from "./listing";

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
	it("allows publish only from submitted, and only by an admin", () => {
		expect(canTransition("submitted", "published", "admin")).toBe(true);
		expect(canTransition("submitted", "published", "owner")).toBe(false);
		expect(canTransition("draft", "published", "admin")).toBe(false);
	});

	it("lets owners submit, withdraw and resubmit", () => {
		expect(canTransition("draft", "submitted", "owner")).toBe(true);
		expect(canTransition("submitted", "draft", "owner")).toBe(true);
		expect(canTransition("unpublished", "submitted", "owner")).toBe(true);
	});

	it("makes removed final", () => {
		for (const to of ["draft", "submitted", "published", "unpublished"] as const) {
			expect(canTransition("removed", to)).toBe(false);
		}
	});
});

describe("transitionSchema", () => {
	it("requires a valid tag to submit", () => {
		expect(transitionSchema.safeParse({ to: "submitted", tag: "v1.0.0" }).success).toBe(true);
		for (const tag of ["", "-x", "a..b", "v1.lock", "v1/", "has space"]) {
			expect(transitionSchema.safeParse({ to: "submitted", tag }).success).toBe(false);
		}
		expect(transitionSchema.safeParse({ to: "submitted" }).success).toBe(false);
	});
});
