import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "am-doctor-"));
process.env.APPMARKET_HOME = join(dir, "home");
process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
process.env.CLAUDE_SETTINGS = join(dir, "claude", "settings.json");
const { adapterHealth, newer } = await import("./doctor.ts");
const { adapter } = await import("./adapter.ts");

const transcript = (line: object) => {
	mkdirSync(join(dir, "claude", "projects", "p"), { recursive: true });
	writeFileSync(join(dir, "claude", "projects", "p", "s.jsonl"), JSON.stringify(line) + "\n");
};

describe("doctor", () => {
	it("reports a readable transcript as healthy and a changed format as broken", () => {
		adapter("install", "claude-code");
		transcript({ type: "assistant", timestamp: "2026-10-04T00:00:00Z", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } } });
		expect(adapterHealth("claude-code").level).toBe("ok");
		transcript({ type: "assistant", timestamp: "2026-10-04T00:00:00Z", msg: { renamed: true } });
		expect(adapterHealth("claude-code")).toMatchObject({ level: "fail" });
	});

	it("compares versions", () => {
		expect([newer("0.2.0", "0.1.9"), newer("0.1.0", "0.1.0"), newer("0.1.10", "0.1.9"), newer("0.0.9", "0.1.0")]).toEqual([true, false, true, false]);
	});
});
