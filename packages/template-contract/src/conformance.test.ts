import { describe, expect, it } from "vitest";
import { blockingFailures, evaluateConformance, RULESET } from "./conformance";

const contract = { errors: [{ rule: "agents-md", file: "AGENTS.md", message: "Add one." }], warnings: [{ rule: "hardcoded-ids", file: "wrangler.jsonc", message: "id" }], manifest: null };

describe("conformance rules (#68)", () => {
	it("checks every rule of the versioned set", () => {
		const r = evaluateConformance({ contract, hasLicense: false, security: "pending", commits: 10, unattributed: 3 });
		expect(r.map((x) => x.id)).toEqual(RULESET.rules.map((x) => x.id));
		const by = Object.fromEntries(r.map((x) => [x.id, x]));
		expect(by["agents-md"]).toMatchObject({ status: "fail", details: ["AGENTS.md: Add one."] });
		expect(by["hardcoded-ids"]).toMatchObject({ status: "fail", severity: "warning" });
		expect(by["wrangler-config"]!.status).toBe("pass");
		expect(by["security-scan"]!.status).toBe("pending");
		expect(by["license-declared"]!.status).toBe("fail");
		expect(by["attributed-commits"]).toMatchObject({ status: "fail", severity: "info", details: ["3 of the last 10 commits have no checkpoint."] });
		expect(blockingFailures(r).map((x) => x.id)).toEqual(["agents-md"]);
	});
});
