import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-login-"));
process.env.APPMARKET_NO_KEYCHAIN = "1";

const replies: (() => unknown)[] = [];
vi.mock("../api.ts", async (original) => {
	const real = await original<typeof import("../api.ts")>();
	return { ...real, call: vi.fn(async () => replies.shift()!()) };
});
const { ApiError } = await import("../api.ts");
const { login } = await import("./login.ts");
const { loadCredentials } = await import("../credentials.ts");

describe("appmarket login", () => {
	it("keeps waiting through a network error and saves the approved sign-in", async () => {
		replies.push(
			() => ({ device_code: "d", user_code: "ABCD1234", verification_uri: "https://x/device", verification_uri_complete: "https://x/device?user_code=ABCD1234", expires_in: 60, interval: 0 }),
			() => {
				throw new TypeError("fetch failed");
			},
			() => {
				throw new ApiError(400, { error: "authorization_pending" });
			},
			() => ({ access_token: "new-token" }),
			() => ({ owner: { handle: "cport1" } }),
			() => ({}),
		);
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		expect(await login("https://staging.example", { noBrowser: true, deviceName: "test", noKeychain: true })).toBe(0);
		expect(await loadCredentials("https://staging.example")).toMatchObject({ token: "new-token", handle: "cport1" });
	}, 10_000);
});
