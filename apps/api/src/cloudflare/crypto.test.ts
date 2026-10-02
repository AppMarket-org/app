import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, pkcePair, randomState } from "./crypto.ts";

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("token encryption", () => {
	it("round-trips for the same user only", async () => {
		const sealed = await encryptToken(key, "access-token-value", "user-1");
		expect(sealed).not.toContain("access-token-value");
		expect(await decryptToken(key, sealed, "user-1")).toBe("access-token-value");
		await expect(decryptToken(key, sealed, "user-2")).rejects.toThrow();
	});

	it("uses a fresh IV each time and rejects a wrong key", async () => {
		const a = await encryptToken(key, "t", "u");
		const b = await encryptToken(key, "t", "u");
		expect(a).not.toBe(b);
		const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
		await expect(decryptToken(other, a, "u")).rejects.toThrow();
	});

	it("refuses a key of the wrong size", async () => {
		await expect(encryptToken(btoa("short"), "t", "u")).rejects.toThrow(/32 bytes/);
	});
});

describe("PKCE and state", () => {
	it("derives the S256 challenge from the verifier", async () => {
		const { verifier, challenge } = await pkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
		expect(challenge).toBe(btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
		expect(randomState()).not.toBe(randomState());
	});
});
