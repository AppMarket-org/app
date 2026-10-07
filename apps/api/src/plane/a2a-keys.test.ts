import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
const { hashKey, newKey } = await import("./a2a-keys.ts");

describe("repo A2A keys", () => {
	it("are random, prefixed, URL-safe, and stored only as a SHA-256", async () => {
		const a = newKey();
		const b = newKey();
		expect(a).toMatch(/^ama2a_[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(await hashKey(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashKey(a)).toBe(await hashKey(a));
		expect(await hashKey(a)).not.toBe(await hashKey(b));
	});
});
