import type { Runtime } from "@appmarket/shared";
import { CONTRACT_FILES, checkTemplate, evaluateConformance, RULESET, type RuleResult } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { readFiles, readRootEntries } from "../artifacts/git.ts";
import { CheckStore } from "../checks/store.ts";

interface Target {
	id: string;
	gitRepo: string;
	runtime: Runtime;
}

/** Mirrors the code's rule set into D1 once per version. */
async function publishRuleset(): Promise<void> {
	await env.DB.batch(
		RULESET.rules.map((r) => env.DB.prepare("INSERT OR IGNORE INTO conformance_rules (id, version, description, severity) VALUES (?, ?, ?, ?)").bind(r.id, RULESET.version, r.description, r.severity)),
	);
}

/** #68: evaluates a commit against the current rule set and stores the results. */
export async function evaluateCommit(repo: Target, commit: string): Promise<RuleResult[]> {
	await publishRuleset();
	const [root, files] = await Promise.all([readRootEntries(repo.gitRepo, commit), readFiles(repo.gitRepo, commit, [...CONTRACT_FILES, "LICENSE", "LICENSE.md", "LICENSE.txt"])]);
	const contract = checkTemplate({ runtime: repo.runtime, rootEntries: root.map((e) => e.name), files });
	let license = files.has("LICENSE") || files.has("LICENSE.md") || files.has("LICENSE.txt");
	try {
		license ||= typeof (JSON.parse(files.get("package.json") ?? "{}") as { license?: unknown }).license === "string";
	} catch {
		// No package.json license.
	}
	// G5 backstop: recent commits (up to this one) without a checkpoint.
	using git = await env.ARTIFACTS.get(repo.gitRepo);
	const log = await git.log({ ref: commit, limit: 100 }).catch(() => []);
	const shas = log.map((c) => c.hash);
	// D1 binds at most 100 variables per statement: look the commits up in batches.
	const withCheckpoint = new Set<string>();
	for (let i = 0; i < shas.length; i += 50) {
		const batch = shas.slice(i, i + 50);
		const { results } = await env.DB.prepare(`SELECT DISTINCT commit_sha FROM checkpoints WHERE repo_id = ? AND commit_sha IN (${batch.map(() => "?").join(",")})`)
			.bind(repo.id, ...batch)
			.all<{ commit_sha: string }>();
		for (const r of results) withCheckpoint.add(r.commit_sha);
	}
	const results = evaluateConformance({ contract, hasLicense: license, security: "none", commits: shas.length, unattributed: shas.filter((s) => !withCheckpoint.has(s)).length });
	await env.DB.prepare("INSERT OR REPLACE INTO conformance_results (repo_id, commit_sha, ruleset_version, results) VALUES (?, ?, ?, ?)").bind(repo.id, commit, RULESET.version, JSON.stringify(results)).run();
	return results;
}

/** Stored results for a commit (evaluated now if missing), with the security rule read live from #27 checks. */
export async function resultsFor(repo: Target, commit: string): Promise<{ version: number; commit: string; results: RuleResult[]; checkedAt: string }> {
	const row = await env.DB.prepare("SELECT results, created_at FROM conformance_results WHERE repo_id = ? AND commit_sha = ? AND ruleset_version = ?").bind(repo.id, commit, RULESET.version).first<{ results: string; created_at: string }>();
	const results = row ? (JSON.parse(row.results) as RuleResult[]) : await evaluateCommit(repo, commit);
	const run = await new CheckStore(env.DB).latestFor(repo.id, commit);
	const security = run?.results?.find((r) => r.name === "security");
	for (const r of results) {
		if (r.id !== "security-scan") continue;
		r.status = security ? (security.status === "failed" ? "fail" : "pass") : run && (run.status === "queued" || run.status === "running") ? "pending" : run?.status === "error" ? "fail" : r.status;
		r.details = security?.status === "failed" ? [security.output.split("\n").slice(-3).join(" ").slice(0, 300)] : !run ? ["Not run yet for this version."] : [];
	}
	return { version: RULESET.version, commit, results, checkedAt: row?.created_at ?? new Date().toISOString() };
}
