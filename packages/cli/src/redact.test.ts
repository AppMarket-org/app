import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRedactor, envValues } from "./redact.ts";

// Fixtures are built at runtime so the secrets check never sees a token-shaped literal.
const fake = (prefix: string, n = 36) => prefix + "x".repeat(n);

describe("redactor", () => {
	it("replaces known secret formats and counts them", () => {
		const r = createRedactor();
		const input = `use ${fake("sk-ant-")} and ${fake("ghp_")} then ${fake("AKIA", 16).toUpperCase()} at postgres://me:hunter22@db.example.test/app`;
		const out = r.text(input);
		expect(out).not.toContain("sk-ant-x");
		expect(out).not.toContain("ghp_x");
		expect(out).not.toContain("hunter22");
		expect(out).toContain("[redacted:anthropic]");
		expect(out).toContain("[redacted:github]");
		expect(out).toContain("[redacted:connection-string]");
		expect(r.count).toBe(4);
	});

	it("replaces values from the repo's .env files, but not .env.example", () => {
		const root = mkdtempSync(join(tmpdir(), "am-redact-"));
		writeFileSync(join(root, ".env"), "API_SECRET=plainvalue123\nSHORT=abc\n");
		writeFileSync(join(root, ".env.example"), "API_SECRET=examplevalue99\n");
		const values = envValues(root);
		expect(values).toEqual(["plainvalue123"]);
		const r = createRedactor({ envValues: values });
		expect(r.text("the key is plainvalue123, ok")).toBe("the key is [redacted:env], ok");
	});

	it("counts a planted AWS key and a .env value (#115)", () => {
		const r = createRedactor({ envValues: ["plainvalue123"] });
		expect(r.text(`key ${"AKIA" + "ABCDEFGH12345678"} and plainvalue123`)).toBe("key [redacted:aws] and [redacted:env]");
		expect(r.count).toBe(2);
	});

	it("applies custom patterns and ignore paths", () => {
		const r = createRedactor({ extra: ["ACME-[0-9]{6}"], ignore: ["secrets/**"] });
		expect(r.text("ticket ACME-123456")).toBe("ticket [redacted:custom]");
		expect(r.sensitivePath("secrets/prod.json")).toBe(true);
		expect(r.sensitivePath("config/.env.local")).toBe(true);
		expect(r.sensitivePath("src/index.ts")).toBe(false);
	});
});
