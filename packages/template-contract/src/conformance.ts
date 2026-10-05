import type { ContractResult } from "@appmarket/shared";

/**
 * #68 (G3): the published conformance rules. Versioned: a change to the set bumps `version`, and
 * results record the version they were checked against. Pure; unit-tested.
 */
export type RuleSeverity = "error" | "warning" | "info";
export interface ConformanceRule {
	id: string;
	description: string;
	severity: RuleSeverity;
}
export type RuleStatus = "pass" | "fail" | "pending";
export interface RuleResult extends ConformanceRule {
	status: RuleStatus;
	details: string[];
}

export const RULESET: { version: number; rules: ConformanceRule[] } = {
	version: 1,
	rules: [
		{ id: "agents-md", severity: "error", description: "An AGENTS.md tells AI agents what the app does and how to run and test it." },
		{ id: "no-committed-secrets", severity: "error", description: "No files that usually hold real secrets (.env, .dev.vars, keys) are committed." },
		{ id: "wrangler-config", severity: "error", description: "A parseable Wrangler config at the repo root." },
		{ id: "wrangler-fields", severity: "error", description: "The Wrangler config sets a name, a compatibility date and an entry or assets." },
		{ id: "vars-not-secret", severity: "error", description: "No secret-looking values in public vars." },
		{ id: "binding-complete", severity: "error", description: "Every binding has the fields needed to provision it." },
		{ id: "container-image", severity: "error", description: "Container images are published and pinned by digest." },
		{ id: "security-scan", severity: "error", description: "The automated security scan (committed secrets, high and critical vulnerabilities) passes." },
		{ id: "hardcoded-ids", severity: "warning", description: "No resource IDs from the developer's own Cloudflare account." },
		{ id: "secrets-documented", severity: "warning", description: "Secret names are listed in .dev.vars.example or .env.example." },
		{ id: "build-script", severity: "warning", description: "A build or deploy script, when the Worker needs a build step." },
		{ id: "container-binding", severity: "warning", description: "Each container class has a Durable Object binding." },
		{ id: "license-declared", severity: "warning", description: "A license: a LICENSE file or a license field in package.json." },
		{ id: "attributed-commits", severity: "info", description: "Commits carry a checkpoint (who or which agent made them, with what). Unattributed commits are reported, never blocked." },
	],
};

export interface ConformanceInput {
	contract: ContractResult;
	hasLicense: boolean;
	/** #27 checks of this commit: passed, failed, still running, or never run. */
	security: "passed" | "failed" | "pending" | "none";
	commits: number;
	unattributed: number;
}

export function evaluateConformance(input: ConformanceInput): RuleResult[] {
	const issues = [...input.contract.errors, ...input.contract.warnings];
	return RULESET.rules.map((rule): RuleResult => {
		if (rule.id === "security-scan") {
			const status: RuleStatus = input.security === "passed" ? "pass" : input.security === "failed" ? "fail" : "pending";
			return { ...rule, status, details: input.security === "none" ? ["Not run yet for this version."] : [] };
		}
		if (rule.id === "license-declared") return { ...rule, status: input.hasLicense ? "pass" : "fail", details: input.hasLicense ? [] : ["Add a LICENSE file or a license field in package.json."] };
		if (rule.id === "attributed-commits") {
			return { ...rule, status: input.unattributed === 0 ? "pass" : "fail", details: input.unattributed ? [`${input.unattributed} of the last ${input.commits} commits have no checkpoint.`] : [] };
		}
		const hits = issues.filter((i) => i.rule === rule.id);
		return { ...rule, status: hits.length ? "fail" : "pass", details: hits.map((h) => `${h.file}: ${h.message}`) };
	});
}

/** Blocking rules that fail (errors only); warnings and info never block. */
export const blockingFailures = (results: RuleResult[]) => results.filter((r) => r.severity === "error" && r.status === "fail");
