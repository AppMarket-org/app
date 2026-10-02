import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, redact, redactText } from "./log.ts";

describe("redaction", () => {
	it("removes credentials from text", () => {
		const text = "push with art_v2_abcdefghijklmnopqrstuvwx and Bearer abc.def-123 then eyJhbGciOi.eyJzdWIiOi.c2ln at https://appmarket.org/api/downloads/x?sig=deadbeef&exp=1";
		const out = redactText(text);
		expect(out).not.toMatch(/art_v2_|abc\.def|eyJ|deadbeef/);
		expect(out).toContain("push with [redacted]");
	});

	it("drops secret-named fields at any depth and keeps the rest", () => {
		expect(redact({ slug: "app", token: "x", nested: { clientSecret: "y", list: [{ Authorization: "z", ok: 1 }] }, code: "c" })).toEqual({
			slug: "app",
			token: "[redacted]",
			nested: { clientSecret: "[redacted]", list: [{ Authorization: "[redacted]", ok: 1 }] },
			code: "[redacted]",
		});
	});

	it("serializes errors without credentials", () => {
		const out = redact(new Error("failed for Bearer sk-123")) as { message: string };
		expect(out.message).toBe("failed for [redacted]");
	});
});

describe("logEvent", () => {
	afterEach(() => vi.restoreAllMocks());

	it("writes one JSON line per event", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		logEvent("token.minted", { slug: "app", scope: "read", token: "art_v1_secretsecretsecret" });
		expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({ event: "token.minted", slug: "app", scope: "read", token: "[redacted]" });
	});
});
