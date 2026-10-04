import { describe, expect, it } from "vitest";
import { joinLogs, logSection } from "./logs";

describe("deploy logs (#40)", () => {
	it("keeps the tail, strips colours and redacts secrets", () => {
		const stdout = `${Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")}\n\x1b[32mDeployed\x1b[0m with sk-ant-api03-${"a".repeat(40)}`;
		const s = logSection("build", { stdout, stderr: "warning" });
		expect(s.startsWith("== build ==\n… ")).toBe(true);
		expect(s).toContain("Deployed with");
		expect(s).not.toContain("\x1b[");
		expect(s).not.toContain("aaaaaaaaaa");
		expect(s).toContain("warning");
		expect(s).not.toContain("line 50\n");
		expect(joinLogs(null, s).length).toBeLessThanOrEqual(48_000);
	});
});
