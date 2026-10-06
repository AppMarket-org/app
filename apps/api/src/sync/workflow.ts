import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts } from "@cloudflare/ci";
import type { CiBindings } from "@cloudflare/ci/worker";
import { env } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { listBranches, mintGitToken, revokeGitToken } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { parseMarkers } from "../plane/merge-commands.ts";
import { checkPull } from "../pulls/checks.ts";
import { notifyPull, repoOwners } from "../pulls/notify.ts";
import { insertPull } from "../pulls/store.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import { syncScript } from "./commands.ts";

export type SyncParams = CiParams<CloudflareArtifacts> & { syncId: string };

interface SyncRow {
	id: string;
	tag: string;
	commit_sha: string;
	fork_id: string;
	fork_git: string;
	fork_name: string;
	fork_owner: string;
	upstream_git: string;
	upstream_name: string;
	upstream_author: string;
}

const stdout = (logs: { stdout: unknown }) => (typeof logs.stdout === "string" ? logs.stdout : "");

/**
 * #73 (G8): brings a template's new version to one opted-in fork as a pull request. The version
 * is pushed to the fork as appmarket/upstream/<tag> from a fresh container that never runs either
 * repo's code; the pull request then runs the fork's checks, merging runs conformance, conflicts
 * are reported (never merged by themselves), and a merge redeploys like any push.
 */
export class UpstreamSyncWorkflow extends CIWorkflow<CloudflareArtifacts, Env & CiBindings> {
	protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
		const { syncId } = event.payload as SyncParams;
		const row = await step.do("load", () => loadSync(syncId));
		if (!row) return;
		const set = (name: string, status: string, fields: { pull_id?: string; error?: string } = {}) =>
			step.do(name, async () => {
				await env.DB.prepare("UPDATE upstream_syncs SET status = ?, pull_id = COALESCE(?, pull_id), error = ? WHERE id = ?").bind(status, fields.pull_id ?? null, fields.error ?? null, syncId).run();
			});
		try {
			const base = await step.do("base", async () => {
				const b = await listBranches(row.fork_git);
				return pickBranch(b.defaultBranch, b.branches)?.name ?? b.defaultBranch;
			});
			const branch = `appmarket/upstream/${row.tag}`;
			const up = await mintGitToken(row.upstream_git, "read", 1800);
			const fork = await mintGitToken(row.fork_git, "write", 1800);
			let out: ReturnType<typeof parseMarkers>;
			try {
				out = parseMarkers(
					stdout(
						(
							await ci.runner({
								name: "sync",
								command: syncScript,
								env: { UP_REMOTE: up.remote, UP_TOKEN: up.token, FORK_REMOTE: fork.remote, FORK_TOKEN: fork.token, TAG: row.tag, BASE: base, BRANCH: branch },
								config: { timeout: 10 * 60_000, retries: { limit: 1, delay: 10_000 } },
							})
						).logs,
					),
				);
			} finally {
				await Promise.all([revokeGitToken(row.upstream_git, up.id).catch(() => false), revokeGitToken(row.fork_git, fork.id).catch(() => false)]);
			}
			if (out.status === "current") return void (await set("status: current", "current"));
			if (out.status !== "pushed" || !out.head) return void (await set("status: failed", "failed", { error: out.status === "no_tag" ? `${row.upstream_name} has no tag ${row.tag}.` : "The new version could not be brought into the fork." }));
			const head = out.head;

			const pull = await step.do("open pull request", async () => {
				const body = [
					`${row.upstream_name} published **${row.tag}**. This brings it into ${row.fork_name}.`,
					"The checks run on it now; merging runs conformance too, then redeploys like any push. Conflicts with your own changes are listed here, and nothing is merged without you.",
					`See what changed in [${row.upstream_name}](${env.PUBLIC_ORIGIN}/${row.upstream_name}).`,
				].join("\n\n");
				const opened = await insertPull({ repoId: row.fork_id, title: `Update to ${row.upstream_name} ${row.tag}`, body, authorId: row.upstream_author, sourceRepoId: row.fork_id, sourceBranch: branch, targetBranch: base, headSha: head });
				// An older update still open is superseded by this one.
				await env.DB.prepare(
					`UPDATE pull_requests SET state = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					 WHERE repo_id = ? AND state = 'open' AND id != ? AND source_repo_id = ? AND source_branch LIKE 'appmarket/upstream/%'`,
				)
					.bind(row.fork_id, opened.id, row.fork_id)
					.run();
				return opened;
			});
			await set("status: opened", "opened", { pull_id: pull.id });
			await step.do("checks", () => checkPull(row.fork_id, branch, head));
			await step.do("notify", async () => {
				const owners = await repoOwners(row.fork_owner);
				await notifyPull({ repo: row.fork_name, number: pull.number, title: `Update to ${row.upstream_name} ${row.tag}`, actorId: "", actor: row.upstream_name, what: `published ${row.tag}; a pull request brings it into your repo`, userIds: owners }).catch(() => undefined);
			});
			await step.do("log", async () => logEvent("sync.opened", { fork: row.fork_name, upstream: row.upstream_name, tag: row.tag, number: pull.number }));
		} catch (error) {
			await set("status: error", "failed", { error: `The update stopped: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) });
			throw error;
		}
	}
}

async function loadSync(id: string): Promise<SyncRow | null> {
	return env.DB.prepare(
		`SELECT s.id, s.tag, s.commit_sha, f.id AS fork_id, f.git_repo AS fork_git, fo.handle || '/' || f.slug AS fork_name, f.owner_id AS fork_owner,
		        u.git_repo AS upstream_git, uo.handle || '/' || u.slug AS upstream_name, u.created_by AS upstream_author
		 FROM upstream_syncs s JOIN repos f ON f.id = s.fork_id JOIN owners fo ON fo.id = f.owner_id JOIN repos u ON u.id = s.upstream_id JOIN owners uo ON uo.id = u.owner_id
		 WHERE s.id = ? AND f.git_repo IS NOT NULL AND u.git_repo IS NOT NULL AND f.state != 'removed'`,
	)
		.bind(id)
		.first<SyncRow>();
}
