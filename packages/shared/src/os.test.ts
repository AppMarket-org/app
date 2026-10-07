import { describe, expect, it } from "vitest";
import { osFromUserAgent } from "./os";

describe("osFromUserAgent", () => {
	it("reads the CLI's platform and browsers' systems", () => {
		expect(osFromUserAgent("appmarket-cli/0.9.0 (darwin; arm64)")).toBe("macOS");
		expect(osFromUserAgent("appmarket-cli/0.9.0 (linux; x64)")).toBe("Linux");
		expect(osFromUserAgent("appmarket-cli/0.9.0 (win32; x64)")).toBe("Windows");
		expect(osFromUserAgent("appmarket-cli/0.8.0")).toBeNull();
		expect(osFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")).toBe("macOS");
		expect(osFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)")).toBe("iOS");
		expect(osFromUserAgent("Mozilla/5.0 (Linux; Android 16; Pixel 10)")).toBe("Android");
		expect(osFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
		expect(osFromUserAgent(null)).toBeNull();
	});
});
