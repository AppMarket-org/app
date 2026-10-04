import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCommand, parseCheck } from "./commands.ts";

const sh = (cwd: string, command: string) => execFileSync("bash", ["-c", command], { cwd, encoding: "utf8" });

describe("check commands (#27)", () => {
	it("report passed, failed and skipped per check, and catch a committed secret", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-checks-"));
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: { lint: "echo lint ok", test: "echo 'expected 2 got 3' && exit 1" } }));
		writeFileSync(join(dir, "config.js"), `export const key = "sk-ant-${"z".repeat(30)}";\n`);
		writeFileSync(join(dir, "ignored.js"), "");
		const lint = parseCheck("lint", sh(dir, checkCommand("lint")));
		const test = parseCheck("test", sh(dir, checkCommand("test")));
		const typecheck = parseCheck("typecheck", sh(dir, checkCommand("typecheck")));
		const security = parseCheck("security", sh(dir, checkCommand("security")));
		expect(lint).toMatchObject({ status: "passed", output: expect.stringContaining("lint ok") });
		expect(test).toMatchObject({ status: "failed", output: expect.stringContaining("expected 2 got 3") });
		expect(typecheck.status).toBe("skipped");
		expect(security).toMatchObject({ status: "failed", output: expect.stringContaining("possible anthropic secret in config.js") });
	});

	it("treats missing output as a failure", () => {
		expect(parseCheck("lint", "")).toMatchObject({ status: "failed" });
	});
});
