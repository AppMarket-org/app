import { describe, expect, it } from "vitest";
import { signDownload, verifyDownload } from "./signing.ts";

const secret = "test-secret";
const exp = Math.floor(Date.now() / 1000) + 300;

describe("download link signing", () => {
	it("verifies its own signature until expiry", async () => {
		const sig = await signDownload(secret, "r1", exp);
		expect(await verifyDownload(secret, "r1", exp, sig)).toBe(true);
		expect(await verifyDownload(secret, "r1", exp, sig, (exp + 1) * 1000)).toBe(false);
	});

	it("rejects another release, another expiry, another key or a malformed signature", async () => {
		const sig = await signDownload(secret, "r1", exp);
		expect(await verifyDownload(secret, "r2", exp, sig)).toBe(false);
		expect(await verifyDownload(secret, "r1", exp + 60, sig)).toBe(false);
		expect(await verifyDownload("other-secret", "r1", exp, sig)).toBe(false);
		expect(await verifyDownload(secret, "r1", exp, "zz")).toBe(false);
		expect(await verifyDownload(secret, "r1", Number.NaN, sig)).toBe(false);
	});
});
