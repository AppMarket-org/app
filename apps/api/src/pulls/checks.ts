import type { PullChecks } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { startChecks } from "../checks/start.ts";
import { CheckStore } from "../checks/store.ts";
import { logEvent } from "../observability/log.ts";

/**
 * Checks for a pull request's head, run when it is opened and whenever its branch moves, in the
 * repo the branch lives in. Merging reuses a passed run for the same commit (once per commit).
 */
export async function checkPull(sourceRepoId: string, branch: string, head: string): Promise<void> {
	const source = await env.DB.prepare("SELECT r.id, r.git_repo, o.handle || '/' || r.slug AS full_name FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.id = ?")
		.bind(sourceRepoId)
		.first<{ id: string; git_repo: string | null; full_name: string }>();
	if (!source?.git_repo) return;
	await startChecks({ id: source.id, gitRepo: source.git_repo, fullName: source.full_name }, head, "push", `refs/heads/${branch}`).catch((error: unknown) =>
		logEvent("pull.checks_failed_to_start", { repo: source.full_name, error: String(error) }, "warn"),
	);
}

/** The latest checks on the head commit. */
export async function pullChecks(sourceRepoId: string, head: string | null): Promise<PullChecks | null> {
	if (!head) return null;
	const run = await new CheckStore(env.DB).latestFor(sourceRepoId, head);
	if (!run) return null;
	return { status: run.status, sha: head, failed: (run.results ?? []).filter((r) => r.status === "failed").map((r) => r.name) };
}
