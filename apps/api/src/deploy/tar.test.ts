import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitPath, tarEnd, tarEntry } from "./tar";

describe("tar writer (#41)", () => {
	it("writes archives the system tar extracts, including long paths", () => {
		const long = `app/${"deep/".repeat(30)}file.txt`;
		const enc = new TextEncoder();
		const parts = [...tarEntry("app/README.md", enc.encode("# Hi\n"), Date.now()), ...tarEntry(long, enc.encode("x".repeat(1000)), Date.now()), tarEnd()];
		const dir = mkdtempSync(join(tmpdir(), "tar-"));
		writeFileSync(join(dir, "a.tar"), Buffer.concat(parts));
		execFileSync("tar", ["-xf", "a.tar"], { cwd: dir });
		expect(readFileSync(join(dir, "app/README.md"), "utf8")).toBe("# Hi\n");
		expect(readFileSync(join(dir, long), "utf8")).toHaveLength(1000);
	});

	it("rejects paths that cannot fit", () => {
		expect(splitPath("a".repeat(101))).toBeNull();
	});
});
