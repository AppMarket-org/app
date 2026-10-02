import type { Listing, ListingState, TransitionRequest } from "@appmarket/shared";

const CLEAR_SUBMITTED = "submitted_tag = NULL, submitted_commit = NULL";

/**
 * UPDATE for a lifecycle transition, binding exactly the parameters each SET clause uses
 * (D1 rejects extra bindings). Matches only while the listing is still in its current state.
 */
export function transitionUpdate(
	listing: Pick<Listing, "id" | "state">,
	request: TransitionRequest,
	actorId: string,
	submittedCommit: string | null,
): { sql: string; params: unknown[] } {
	const set: Record<ListingState, [string, unknown[]]> = {
		submitted: ["submitted_tag = ?, submitted_commit = ?", [request.to === "submitted" ? request.tag : null, submittedCommit]],
		draft: [CLEAR_SUBMITTED, []],
		published: [`published_tag = submitted_tag, published_commit = submitted_commit, ${CLEAR_SUBMITTED}, approved_by = ?`, [actorId]],
		unpublished: [CLEAR_SUBMITTED, []],
		removed: [CLEAR_SUBMITTED, []],
	};
	const [setSql, setParams] = set[request.to];
	return {
		sql: `UPDATE listings SET state = ?, ${setSql}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND state = ?`,
		params: [request.to, ...setParams, listing.id, listing.state],
	};
}
