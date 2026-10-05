import type { DeployManifest } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { readFiles } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { graphEdges, rangeAllows } from "./extract.ts";

/** #67 (G1): records a version's edges (replacing the previous version's). */
export async function recordGraph(repoId: string, gitRepo: string, commit: string, manifest: DeployManifest | null): Promise<number> {
	const files = await readFiles(gitRepo, commit, ["package.json"]);
	const edges = graphEdges(files.get("package.json"), manifest);
	await env.DB.batch([
		env.DB.prepare("DELETE FROM graph_edges WHERE repo_id = ?").bind(repoId),
		...edges.map((e) => env.DB.prepare("INSERT OR IGNORE INTO graph_edges (repo_id, kind, target, detail) VALUES (?, ?, ?, ?)").bind(repoId, e.kind, e.target, e.detail)),
		env.DB.prepare("UPDATE repos SET graph_commit = ? WHERE id = ?").bind(commit, repoId),
	]);
	return edges.length;
}

/** On fork: the fork starts as the source's published version, so it gets the same edges. */
export async function copyGraph(fromRepoId: string, toRepoId: string): Promise<void> {
	await env.DB.batch([
		env.DB.prepare("INSERT OR IGNORE INTO graph_edges (repo_id, kind, target, detail) SELECT ?, kind, target, detail FROM graph_edges WHERE repo_id = ?").bind(toRepoId, fromRepoId),
		env.DB.prepare("UPDATE repos SET graph_commit = (SELECT graph_commit FROM repos WHERE id = ?) WHERE id = ?").bind(fromRepoId, toRepoId),
	]);
}

/** Cron: published repos whose graph describes an older version (or none). */
export async function backfillGraph(limit = 5): Promise<void> {
	const { results } = await env.DB.prepare(
		"SELECT id, git_repo, published_commit, published_manifest FROM repos WHERE state = 'published' AND git_repo IS NOT NULL AND published_commit IS NOT NULL AND (graph_commit IS NULL OR graph_commit != published_commit) LIMIT ?",
	)
		.bind(limit)
		.all<{ id: string; git_repo: string; published_commit: string; published_manifest: string | null }>();
	for (const r of results) {
		try {
			await recordGraph(r.id, r.git_repo, r.published_commit, r.published_manifest ? (JSON.parse(r.published_manifest) as DeployManifest) : null);
		} catch (error) {
			// Mark it so one broken repo is not retried every minute; the next publish records again.
			await env.DB.prepare("UPDATE repos SET graph_commit = published_commit WHERE id = ?").bind(r.id).run();
			logEvent("graph.failed", { repo: r.id, error: error instanceof Error ? error.message : String(error) }, "warn");
		}
	}
}

interface Linked {
	id: string;
	full_name: string;
	name: string;
	state: string;
}

const PATH = "o.handle || '/' || r.slug";

/** Ancestors (nearest first, at most 20) and direct children (forks, not agent sessions). */
export async function lineage(repoId: string): Promise<{ ancestors: Linked[]; children: Linked[]; descendants: number }> {
	const [ancestors, children, descendants] = await Promise.all([
		env.DB.prepare(
			`WITH RECURSIVE up(id, depth) AS (SELECT forked_from, 1 FROM repos WHERE id = ?1 AND forked_from IS NOT NULL
			   UNION ALL SELECT r.forked_from, up.depth + 1 FROM repos r JOIN up ON r.id = up.id WHERE r.forked_from IS NOT NULL AND up.depth < 20)
			 SELECT r.id, ${PATH} AS full_name, r.name, r.state FROM up JOIN repos r ON r.id = up.id JOIN owners o ON o.id = r.owner_id ORDER BY up.depth`,
		)
			.bind(repoId)
			.all<Linked>(),
		env.DB.prepare(`SELECT r.id, ${PATH} AS full_name, r.name, r.state FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.forked_from = ? AND r.session_of IS NULL AND r.state != 'removed' ORDER BY r.created_at`)
			.bind(repoId)
			.all<Linked>(),
		env.DB.prepare(
			`WITH RECURSIVE down(id, depth) AS (SELECT id, 1 FROM repos WHERE forked_from = ?1 AND state != 'removed'
			   UNION ALL SELECT r.id, down.depth + 1 FROM repos r JOIN down ON r.forked_from = down.id WHERE r.state != 'removed' AND down.depth < 20)
			 SELECT COUNT(*) AS n FROM down`,
		)
			.bind(repoId)
			.first<{ n: number }>(),
	]);
	return { ancestors: ancestors.results, children: children.results, descendants: descendants?.n ?? 0 };
}

export async function edgesOf(repoId: string): Promise<{ kind: string; target: string; detail: string | null }[]> {
	return (await env.DB.prepare("SELECT kind, target, detail FROM graph_edges WHERE repo_id = ? ORDER BY kind, target").bind(repoId).all<{ kind: string; target: string; detail: string | null }>()).results;
}

export interface GraphMatch {
	repo: string;
	name: string;
	state: string;
	kind: string;
	detail: string | null;
	forkedFrom: string | null;
}

/** Repos (forks included) whose recorded version uses a package; with `version`, only ranges that allow it. */
export async function packageUsers(name: string, version?: string): Promise<GraphMatch[]> {
	const { results } = await env.DB.prepare(
		`SELECT ${PATH} AS repo, r.name, r.state, e.kind, e.detail, (SELECT fo.handle || '/' || f.slug FROM repos f JOIN owners fo ON fo.id = f.owner_id WHERE f.id = r.forked_from) AS forked_from
		 FROM graph_edges e JOIN repos r ON r.id = e.repo_id JOIN owners o ON o.id = r.owner_id
		 WHERE e.kind IN ('dependency', 'dev-dependency') AND e.target = ? AND r.state != 'removed' ORDER BY repo LIMIT 1000`,
	)
		.bind(name.toLowerCase())
		.all<GraphMatch & { forked_from: string | null }>();
	return results
		.filter((r) => !version || rangeAllows(r.detail, version))
		.map(({ forked_from, ...r }) => ({ ...r, forkedFrom: forked_from }));
}

export async function bindingUsers(type: string): Promise<GraphMatch[]> {
	const { results } = await env.DB.prepare(
		`SELECT ${PATH} AS repo, r.name, r.state, e.kind, e.detail, NULL AS forked_from FROM graph_edges e JOIN repos r ON r.id = e.repo_id JOIN owners o ON o.id = r.owner_id
		 WHERE e.kind = 'binding' AND e.target = ? AND r.state != 'removed' ORDER BY repo LIMIT 1000`,
	)
		.bind(type)
		.all<GraphMatch & { forked_from: null }>();
	return results.map(({ forked_from, ...r }) => ({ ...r, forkedFrom: forked_from }));
}
