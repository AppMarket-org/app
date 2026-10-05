import { describe, expect, it } from "vitest";
import { DEVICE_CLIENT_SCOPES, grantedScopes, SCOPE_DESCRIPTIONS } from "./device-scopes";

describe("device scopes", () => {
	it("describes every scope a client can get, so the approval page never hides one", () => {
		for (const scopes of Object.values(DEVICE_CLIENT_SCOPES)) for (const s of scopes) expect(SCOPE_DESCRIPTIONS[s], s).toBeTruthy();
	});

	it("grants what was asked for, or the client's default set", () => {
		expect(grantedScopes("appmarket-cli", null)).toContain("git:write");
		expect(grantedScopes("appmarket-cli", "repos:read")).toEqual(["repos:read"]);
		expect(grantedScopes("unknown", "")).toEqual([]);
	});
});
