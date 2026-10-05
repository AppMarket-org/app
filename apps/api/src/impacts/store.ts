import { env } from "cloudflare:workers";
import { rangeOverlaps } from "../graph/extract.ts";
import { logEvent } from "../observability/log.ts";

export interface ImpactRow {
	id: string;
	kind: "package" | "rule";
	target: string;
	affected: string | null;
	title: string;
	guidance: string;
	created_at: string;
	checked_at: string | null;
	closed_at: string | null;
}

/** Repos (forks included) that carry the impact now, with what makes them affected. */
async function matches(impact: ImpactRow): Promise<Map<string, string | null>> {
	const found = new Map<string, string | null>();
	if (impact.kind === "package") {
		const { results } = await env.DB.prepare(
			"SELECT e.repo_id, e.detail FROM graph_edges e JOIN repos r ON r.id = e.repo_id WHERE e.kind IN ('dependency', 'dev-dependency') AND e.target = ? AND r.state != 'removed'",
		)
			.bind(impact.target.toLowerCase())
			.all<{ repo_id: string; detail: string | null }>();
		for (const r of results) if (!impact.affected || rangeOverlaps(r.detail, impact.affected)) found.set(r.repo_id, r.detail ? `declares ${impact.target} ${r.detail}` : null);
		return found;
	}
	// A rule: the newest conformance result of each repo.
	const { results } = await env.DB.prepare(
		`SELECT c.repo_id, c.results FROM conformance_results c JOIN repos r ON r.id = c.repo_id
		 WHERE r.state != 'removed' AND c.created_at = (SELECT MAX(created_at) FROM conformance_results x WHERE x.repo_id = c.repo_id)`,
	).all<{ repo_id: string; results: string }>();
	for (const r of results) {
		const rule = (JSON.parse(r.results) as { id: string; status: string; details: string[] }[]).find((x) => x.id === impact.target);
		if (rule?.status === "fail") found.set(r.repo_id, rule.details.join(" ").slice(0, 300) || null);
	}
	return found;
}

/** Brings an impact's repo list up to date: new matches are added, ones that no longer match are resolved. */
export async function syncImpact(impact: ImpactRow): Promise<{ affected: number; resolved: number }> {
	const now = await matches(impact);
	const current = (await env.DB.prepare("SELECT repo_id FROM impact_repos WHERE impact_id = ? AND resolved_at IS NULL").bind(impact.id).all<{ repo_id: string }>()).results.map((r) => r.repo_id);
	const gone = current.filter((id) => !now.has(id));
	await env.DB.batch([
		...[...now].map(([repoId, detail]) =>
			env.DB.prepare("INSERT INTO impact_repos (impact_id, repo_id, detail) VALUES (?, ?, ?) ON CONFLICT (impact_id, repo_id) DO UPDATE SET detail = excluded.detail, resolved_at = NULL")
				.bind(impact.id, repoId, detail),
		),
		...gone.map((repoId) => env.DB.prepare("UPDATE impact_repos SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE impact_id = ? AND repo_id = ?").bind(impact.id, repoId)),
		env.DB.prepare("UPDATE impacts SET checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(impact.id),
	]);
	return { affected: now.size, resolved: gone.length };
}

/** Cron: re-checks the least recently checked open impacts. */
export async function syncOpenImpacts(limit = 5): Promise<void> {
	const { results } = await env.DB.prepare("SELECT * FROM impacts WHERE closed_at IS NULL ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?").bind(limit).all<ImpactRow>();
	for (const impact of results) {
		const r = await syncImpact(impact).catch((e) => (logEvent("impacts.sync_failed", { impact: impact.id, error: String(e) }, "warn"), null));
		if (r?.resolved) logEvent("impacts.resolved", { impact: impact.id, resolved: r.resolved });
	}
}
