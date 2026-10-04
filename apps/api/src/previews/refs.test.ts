import { previewWorkerName } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { parseBranches } from "./refs";

const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;

describe("branch previews (#28)", () => {
	it("parses branches from a Git ref advertisement", () => {
		const a = "a".repeat(40);
		const b = "b".repeat(40);
		const text = pkt("# service=git-upload-pack\n") + "0000" + pkt(`${a} HEAD\0agent=gitty symref=HEAD:refs/heads/main\n`) + pkt(`${b} refs/heads/feature/x\n`) + pkt(`${a} refs/heads/main\n`) + pkt(`${a} refs/tags/v1.0.0\n`) + "0000";
		expect(parseBranches(text)).toEqual([
			{ sha: b, name: "feature/x" },
			{ sha: a, name: "main" },
		]);
		expect(parseBranches("garbage")).toEqual([]);
	});

	it("names preview Workers validly and without collisions", () => {
		expect(previewWorkerName("my-app", "dev")).toBe("my-app-pr-dev");
		const slashed = previewWorkerName("my-app", "feature/Login");
		expect(slashed).toMatch(/^my-app-pr-feature-login-[a-z0-9]+$/);
		expect(slashed).not.toBe(previewWorkerName("my-app", "feature-login"));
		const long = previewWorkerName("a".repeat(80), "b".repeat(100));
		expect(long.length).toBeLessThanOrEqual(63);
		expect(long).toMatch(/^[a-z0-9-]+$/);
		expect(long).not.toMatch(/--|-$/);
	});
});
