import { describe, expect, it } from "vitest";
import { canTransition, hasPendingUpdate, slugify } from "./repo";
import { repoInputSchema, repoSearchSchema, repoUpdateSchema, tokenRequestSchema, transitionSchema } from "./schemas";

describe("slugify", () => {
	it.each([
		["My Cool App!", "my-cool-app"],
		["  Café   Déjà Vu ", "cafe-deja-vu"],
		["***", "app"],
		["a".repeat(70), "a".repeat(60)],
	])("%s -> %s", (name, slug) => expect(slugify(name)).toBe(slug));
});

describe("repoInputSchema", () => {
	it("accepts a valid repo and defaults description", () => {
		const parsed = repoInputSchema.parse({ name: "My App", summary: "Does useful things", category: "ai" });
		expect(parsed).toMatchObject({ description: "", runtime: "workers-js", platforms: ["workers"], license: null });
	});

	it("rejects unknown categories and short names", () => {
		expect(repoInputSchema.safeParse({ name: "x", summary: "Does useful things", category: "nope" }).success).toBe(false);
	});
});

describe("repoUpdateSchema", () => {
	it("leaves omitted fields out instead of resetting them to defaults", () => {
		expect(repoUpdateSchema.parse({ summary: "New summary text" })).toEqual({ summary: "New summary text" });
	});

	it("validates runtime, platforms and license", () => {
		expect(repoUpdateSchema.parse({ platforms: ["pwa", "pwa", "android"] })).toEqual({ platforms: ["pwa", "android"] });
		expect(repoUpdateSchema.safeParse({ runtime: "php" }).success).toBe(false);
		expect(repoUpdateSchema.safeParse({ license: "MIT OR Apache-2.0" }).success).toBe(true);
		expect(repoUpdateSchema.safeParse({ license: "<script>" }).success).toBe(false);
	});
});

describe("repoSearchSchema", () => {
	it("coerces paging and caps page size", () => {
		expect(repoSearchSchema.parse({ page: "2" })).toMatchObject({ page: 2, pageSize: 20 });
		expect(repoSearchSchema.safeParse({ pageSize: "500" }).success).toBe(false);
	});
});

describe("canTransition", () => {
	it("allows publish only from submitted, and only by an admin", () => {
		expect(canTransition("submitted", "published", "admin")).toBe(true);
		expect(canTransition("submitted", "published", "owner")).toBe(false);
		expect(canTransition("draft", "published", "admin")).toBe(false);
	});

	it("lets admins send a submission back to draft (request changes)", () => {
		expect(canTransition("submitted", "draft", "admin")).toBe(true);
	});

	it("lets owners submit updates to a published app, and admins publish or send them back", () => {
		// The app stays public meanwhile (transition-sql keeps the state; the API needs a pending update).
		expect(canTransition("published", "submitted", "owner")).toBe(true);
		expect(canTransition("published", "submitted", "admin")).toBe(false);
		expect(canTransition("published", "published", "admin")).toBe(true);
		expect(canTransition("published", "published", "owner")).toBe(false);
		expect(canTransition("published", "draft", "admin")).toBe(true);
		expect(hasPendingUpdate({ state: "published", submittedTag: "v2" })).toBe(true);
		expect(hasPendingUpdate({ state: "submitted", submittedTag: "v2" })).toBe(false);
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

describe("tokenRequestSchema", () => {
	it("caps lifetimes per scope", () => {
		expect(tokenRequestSchema.safeParse({ scope: "read", ttl: 86_400 }).success).toBe(true);
		expect(tokenRequestSchema.safeParse({ scope: "write", ttl: 86_400 }).success).toBe(false);
		expect(tokenRequestSchema.safeParse({ scope: "write", ttl: 30 }).success).toBe(false);
		expect(tokenRequestSchema.safeParse({ scope: "admin" }).success).toBe(false);
	});
});
