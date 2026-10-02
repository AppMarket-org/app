import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
const { repoNameFor } = await import("./repos.ts");

describe("repoNameFor", () => {
	it("appends a short id to the slug", () => {
		expect(repoNameFor("my-app", "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")).toBe("my-app-3f2a9c1e");
	});

	it("stays within 63 characters and never leaves a double hyphen", () => {
		const name = repoNameFor(`${"a".repeat(53)}-b`, "3f2a9c1e-5b7d");
		expect(name.length).toBeLessThanOrEqual(63);
		expect(name).not.toContain("--");
		expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
	});
});
