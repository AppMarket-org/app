import { describe, expect, it } from "vitest";
import { deviceMayCall, deviceMayCallAuth, grantScopes } from "./scopes.ts";

const all = ["checkpoints:write", "checkpoints:read", "repos:read"];

describe("grantScopes", () => {
	it("defaults to the client's scopes and refuses anything wider or unknown", () => {
		expect(grantScopes("appmarket-cli", undefined)).toEqual([...all, "sessions:write"]);
		expect(grantScopes("appmarket-ci", undefined)).toEqual([...all, "releases:write"]);
		expect(grantScopes("appmarket-ci", "sessions:write")).toBeNull();
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

	it("lets device tokens read the code graph (#240)", () => {
		for (const sub of ["", "/symbols", "/references", "/impact"]) expect(deviceMayCall(["repos:read"], "GET", `/api/repos/dev/app/code-graph${sub}`)).toBe(true);
		expect(deviceMayCall(["repos:read"], "POST", "/api/repos/dev/app/code-graph")).toBe(false);
		expect(deviceMayCall(["checkpoints:write"], "GET", "/api/repos/dev/app/code-graph/symbols")).toBe(false);
	});

	it("lets device tokens read the Agent Card and call the board over A2A (#239)", () => {
		expect(deviceMayCall(["repos:read"], "GET", "/api/repos/dev/app/.well-known/agent-card.json")).toBe(true);
		expect(deviceMayCall(["repos:read"], "GET", "/api/repos/dev/app/a2a")).toBe(true);
		expect(deviceMayCall(["sessions:write"], "POST", "/api/repos/dev/app/a2a")).toBe(true);
		expect(deviceMayCall(["repos:read", "checkpoints:write"], "POST", "/api/repos/dev/app/a2a")).toBe(false);
	});

	it("lets agents in a session use the collaboration plane, but not cancel tasks or watch live (#236)", () => {
		const cli = ["sessions:write"];
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		expect(deviceMayCall(cli, "GET", "/api/repos/dev/app/plane")).toBe(true);
		expect(deviceMayCall(cli, "POST", "/api/repos/dev/app/plane/agents")).toBe(true);
		expect(deviceMayCall(cli, "POST", `/api/repos/dev/app/plane/tasks/${id}/claim`)).toBe(true);
		expect(deviceMayCall(cli, "POST", `/api/repos/dev/app/plane/tasks/${id}/finish`)).toBe(true);
		expect(deviceMayCall(cli, "DELETE", "/api/repos/dev/app/plane/leases")).toBe(true);
		expect(deviceMayCall(cli, "DELETE", `/api/repos/dev/app/plane/tasks/${id}`)).toBe(false);
		expect(deviceMayCall(cli, "GET", "/api/repos/dev/app/plane/live")).toBe(false);
		expect(deviceMayCall(["checkpoints:write", "repos:read"], "POST", "/api/repos/dev/app/plane/agents")).toBe(false);
	});

	it("lets the CLI manage agent sessions with sessions:write only (#29)", () => {
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		for (const [method, path] of [
			["POST", "/api/repos/acme/todo/sessions"],
			["GET", "/api/repos/acme/todo/sessions"],
			["POST", `/api/sessions/${id}/token`],
			["POST", `/api/sessions/${id}/end`],
			["DELETE", `/api/sessions/${id}`],
		] as const) {
			expect(deviceMayCall(["sessions:write"], method, path), `${method} ${path}`).toBe(true);
			expect(deviceMayCall(all, method, path), `${method} ${path}`).toBe(false);
		}
		expect(deviceMayCall(["sessions:write"], "POST", "/api/repos/acme/todo/tokens")).toBe(false);
	});

	it("lets CI tokens upload releases with releases:write (#34)", () => {
		expect(deviceMayCall(["releases:write"], "POST", "/api/repos/acme/todo/releases")).toBe(true);
		expect(deviceMayCall(all, "POST", "/api/repos/acme/todo/releases")).toBe(false);
		expect(deviceMayCall(["releases:write"], "DELETE", "/api/repos/acme/todo/releases/r1")).toBe(false);
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
