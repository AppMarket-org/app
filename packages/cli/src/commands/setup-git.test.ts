import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-git-"));
process.env.APPMARKET_NO_KEYCHAIN = "1";
const { gitOrigin, tokenForRemote } = await import("./setup-git.ts");
const { saveCredentials } = await import("../credentials.ts");

describe("setup-git (#260)", () => {
	it("answers with the sign-in of the remote's host only", async () => {
		await saveCredentials({ api: "https://staging.appmarket.org", token: "device-token", handle: "dev", device: "laptop" }, { noKeychain: true });
		expect(gitOrigin("https://staging.appmarket.org/")).toBe("https://staging.appmarket.org");
		expect(await tokenForRemote("https://staging.appmarket.org/dev/app.git", "https://appmarket.org")).toBe("device-token");
		expect(await tokenForRemote("https://appmarket.org/dev/app.git", "https://appmarket.org")).toBeNull();
		expect(await tokenForRemote("https://github.com/dev/app.git", "https://staging.appmarket.org")).toBeNull();
		expect(await tokenForRemote("not a url", "https://staging.appmarket.org")).toBeNull();
	});
});
