import type { Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { logEvent } from "../observability/log.ts";
import type { SyncParams } from "./workflow.ts";

/** #73: a template published `tag`: start an update for each fork that opted in (once per fork and version). */
export async function startUpstreamSync(upstream: Pick<Repo, "id" | "fullName" | "gitRepo">, tag: string, commit: string): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT r.id FROM repos r JOIN repo_pull_settings s ON s.repo_id = r.id
		 WHERE r.forked_from = ? AND r.state != 'removed' AND r.git_repo IS NOT NULL AND s.upstream_sync = 1 LIMIT 500`,
	)
		.bind(upstream.id)
		.all<{ id: string }>();
	let started = 0;
	for (const fork of results) {
		const id = crypto.randomUUID();
		const inserted = await env.DB.prepare("INSERT OR IGNORE INTO upstream_syncs (id, fork_id, upstream_id, tag, commit_sha) VALUES (?, ?, ?, ?, ?)").bind(id, fork.id, upstream.id, tag, commit).run();
		if (!inserted.meta.changes) continue;
		const params = {
			provider: "cloudflare-artifacts",
			providerData: { namespace: env.ARTIFACTS_NAMESPACE },
			event: { type: "tag" },
			owner: env.ARTIFACTS_NAMESPACE,
			repo: upstream.gitRepo!,
			sha: commit,
			trigger: "tag",
			ref: `refs/tags/${tag}`,
			tag,
			syncId: id,
		} as SyncParams;
		await env.UPSTREAM_SYNC_WORKFLOW.create({ id, params });
		started++;
	}
	if (results.length) logEvent("sync.started", { upstream: upstream.fullName, tag, forks: results.length, started });
	return started;
}
