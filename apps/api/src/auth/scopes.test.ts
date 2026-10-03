import { describe, expect, it } from "vitest";
import { deviceMayCall, deviceMayCallAuth, grantScopes } from "./scopes.ts";

const all = ["checkpoints:write", "checkpoints:read", "repos:read"];

describe("grantScopes", () => {
	it("defaults to the client's scopes and refuses anything wider or unknown", () => {
		expect(grantScopes("appmarket-cli", undefined)).toEqual(all);
		expect(grantScopes("appmarket-cli", "repos:read")).toEqual(["repos:read"]);
		expect(grantScopes("appmarket-cli", "repos:read repos:write")).toBeNull();
		expect(grantScopes("evil", "repos:read")).toBeNull();
	});
});

describe("deviceMayCall", () => {
	it("allows checkpoint and repo reads within scope", () => {
		expect(deviceMayCall(all, "GET", "/api/repos/mine")).toBe(true);
		expect(deviceMayCall(all, "GET", "/api/repos/acme/todo")).toBe(true);
		expect(deviceMayCall(all, "POST", "/api/repos/acme/todo/checkpoints")).toBe(true);
		expect(deviceMayCall(all, "PATCH", "/api/repos/acme/todo/checkpoints/abc123")).toBe(true);
		expect(deviceMayCall(["repos:read"], "POST", "/api/repos/acme/todo/checkpoints")).toBe(false);
	});

	it("refuses everything else", () => {
		for (const [method, path] of [
			["POST", "/api/repos"],
			["PATCH", "/api/repos/acme/todo"],
			["POST", "/api/repos/acme/todo/tokens"],
			["GET", "/api/repos/acme/todo/tokens"],
			["POST", "/api/repos/acme/todo/transitions"],
			["POST", "/api/repos/acme/todo/deployments"],
			["GET", "/api/cloudflare/accounts"],
			["GET", "/api/me/sessions"],
			["PATCH", "/api/me/handle"],
			["POST", "/api/orgs"],
			["GET", "/api/admin/repos"],
		]) {
			expect(deviceMayCall(all, method!, path!), `${method} ${path}`).toBe(false);
		}
	});

	it("limits Better Auth endpoints to the session itself", () => {
		expect(deviceMayCallAuth("/api/auth/get-session")).toBe(true);
		expect(deviceMayCallAuth("/api/auth/sign-out")).toBe(true);
		expect(deviceMayCallAuth("/api/auth/update-user")).toBe(false);
		expect(deviceMayCallAuth("/api/auth/delete-user")).toBe(false);
		expect(deviceMayCallAuth("/api/auth/link-social")).toBe(false);
		expect(deviceMayCallAuth("/api/auth/list-sessions")).toBe(false);
	});
});
