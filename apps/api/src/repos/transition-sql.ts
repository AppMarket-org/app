import type { Repo, RepoState, TransitionRequest } from "@appmarket/shared";

const CLEAR_SUBMITTED = "submitted_tag = NULL, submitted_commit = NULL, submitted_notes = NULL, submitted_checks = NULL";

/**
 * UPDATE for a lifecycle transition, binding exactly the parameters each SET clause uses
 * (D1 rejects extra bindings). Matches only while the repo is still in its current state.
 */
export function transitionUpdate(
	repo: Pick<Repo, "id" | "state">,
	request: TransitionRequest,
	actorId: string,
	submittedCommit: string | null,
	/** JSON of the D2/G4 warnings and D3 manifest for a submit. */
	submittedChecks: string | null = null,
): { sql: string; params: unknown[] } {
	const set: Record<RepoState, [string, unknown[]]> = {
		submitted: [
			"submitted_tag = ?, submitted_commit = ?, submitted_notes = ?, submitted_checks = ?",
			request.to === "submitted" ? [request.tag, submittedCommit, request.releaseNotes, submittedChecks] : [null, null, null, null],
		],
		draft: [CLEAR_SUBMITTED, []],
		// D3: the reviewed version's manifest becomes the repo's.
		published: [
			`published_tag = submitted_tag, published_commit = submitted_commit, published_manifest = json_extract(submitted_checks, '$.manifest'), ${CLEAR_SUBMITTED}, approved_by = ?`,
			[actorId],
		],
		unpublished: [CLEAR_SUBMITTED, []],
		removed: [CLEAR_SUBMITTED, []],
	};
	const [setSql, setParams] = set[request.to];
	return {
		sql: `UPDATE repos SET state = ?, ${setSql}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND state = ?`,
		params: [request.to, ...setParams, repo.id, repo.state],
	};
}
