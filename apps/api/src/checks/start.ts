import type { Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { logEvent } from "../observability/log.ts";
import { CheckStore } from "./store.ts";
import type { ChecksParams } from "./workflow.ts";

/**
 * #27: starts the checks for a commit (once per commit and trigger: a repeated push of the same
 * commit does not run them again).
 */
export async function startChecks(repo: Pick<Repo, "id" | "gitRepo" | "fullName">, commit: string, trigger: "push" | "submit", ref: string): Promise<string | null> {
	if (!repo.gitRepo) return null;
	const store = new CheckStore(env.DB);
	const latest = await store.latestFor(repo.id, commit);
	if (latest && (latest.trigger === trigger || trigger === "push")) return latest.id;
	const id = crypto.randomUUID();
	await store.create(id, repo.id, commit, trigger);
	const params: ChecksParams = {
		provider: "cloudflare-artifacts",
		providerData: { namespace: env.ARTIFACTS_NAMESPACE },
		event: { type: ref.startsWith("refs/tags/") ? "tag" : "push" },
		owner: env.ARTIFACTS_NAMESPACE,
		repo: repo.gitRepo,
		sha: commit,
		trigger: ref.startsWith("refs/tags/") ? "tag" : "push",
		ref,
		...(ref.startsWith("refs/tags/") ? { tag: ref.slice("refs/tags/".length) } : {}),
		runId: id,
	} as ChecksParams;
	await env.CHECKS_WORKFLOW.create({ id, params });
	logEvent("checks.started", { repo: repo.fullName, commit: commit.slice(0, 12), trigger });
	return id;
}
