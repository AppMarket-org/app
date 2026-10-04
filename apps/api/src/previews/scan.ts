import { MAX_PREVIEW_BRANCHES, previewWorkerName } from "@appmarket/shared";
import { buildDeployConfig, CONTRACT_FILES } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { listBranches, readFiles } from "../artifacts/git.ts";
import { finishDeployment, insertDeployment } from "../deploy/store.ts";
import type { DeployParams } from "../deploy/workflow.ts";
import { logEvent } from "../observability/log.ts";
import { previewStore } from "./store.ts";

const BATCH = 20;
const RUNNING = new Set(["queued", "building", "deploying"]);

/**
 * #28 (R8), #37 (D7): runs every minute. For repos with previews or auto deploy on, deploys each
 * branch whose head moved (non-default branches as previews, the default branch to its chosen
 * Worker) into the developer's own Cloudflare account, so untrusted branch code never runs in
 * appmarket.org's account. Artifacts' lastPushAt only tracks the default branch, so each turn
 * lists the branches of the least recently checked repos.
 */
export async function scanPreviews(): Promise<number> {
	let started = 0;
	for (const s of await previewStore.enabled(BATCH)) {
		try {
			await previewStore.checked(s.repo_id);
			const { defaultBranch, branches } = await listBranches(s.git_repo);
			const latest = new Map((await previewStore.latest(s.repo_id)).map((p) => [p.branch, p]));
			// #37: the default branch redeploys to its chosen Worker; other branches get previews.
			const wanted = [
				...(s.deploy_default && s.worker_name ? branches.filter((b) => b.name === defaultBranch) : []),
				...(s.enabled ? branches.filter((b) => b.name !== defaultBranch).slice(0, MAX_PREVIEW_BRANCHES) : []),
			];
			for (const branch of wanted) {
				const current = latest.get(branch.name);
				if (current?.commit === branch.sha) continue;
				// One deploy per branch at a time; the new head is picked up on a later turn.
				if (current && RUNNING.has(current.status)) continue;
				await startPreview(s, branch.name, branch.sha, branch.name === defaultBranch ? s.worker_name! : previewWorkerName(s.slug, branch.name));
				started++;
			}
		} catch (error) {
			logEvent("previews.scan_failed", { repo: s.repo_id, error: error instanceof Error ? error.message : String(error) }, "warn");
		}
	}
	return started;
}

async function startPreview(s: { repo_id: string; user_id: string; account_id: string; git_repo: string; slug: string }, branch: string, sha: string, workerName: string): Promise<void> {
	const id = crypto.randomUUID();
	const plan = buildDeployConfig(await readFiles(s.git_repo, sha, CONTRACT_FILES), workerName);
	await insertDeployment({ id, userId: s.user_id, repoId: s.repo_id, versionTag: branch, commitSha: sha, accountId: s.account_id, workerName, deploy: plan.ok ? plan.deploy : ({} as never), secrets: {}, previewBranch: branch });
	if (!plan.ok) {
		await finishDeployment(id, "failed", { error: plan.reason });
		return;
	}
	const params: DeployParams = {
		provider: "cloudflare-artifacts",
		providerData: { namespace: env.ARTIFACTS_NAMESPACE },
		event: { type: "push" },
		owner: env.ARTIFACTS_NAMESPACE,
		repo: s.git_repo,
		sha,
		trigger: "push",
		ref: `refs/heads/${branch}`,
		deploymentId: id,
	};
	await env.DEPLOY_WORKFLOW.create({ id, params });
	logEvent("preview.started", { deployment: id, repo: s.repo_id, branch });
}
