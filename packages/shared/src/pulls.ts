/** #256: pull requests. A source branch (this repo, or a fork of it) proposed for a target branch. */
export type PullState = "open" | "closed" | "merged";

export const PULL_LIMITS = { title: 200, body: 20_000 } as const;

export interface PullMerge {
	id: string;
	status: "queued" | "rebasing" | "checking" | "merging" | "merged" | "conflict" | "failed";
	sha: string | null;
	error: string | null;
	conflicts?: string[];
}

/** The checks on the pull request's head commit (run when it is opened and each time the branch moves). */
export interface PullChecks {
	status: "queued" | "running" | "passed" | "failed" | "error";
	sha: string;
	/** Names of the checks that failed. */
	failed: string[];
}

export interface PullRequest {
	number: number;
	title: string;
	body: string;
	state: PullState;
	author: string;
	/** The repo the branch lives in (this repo, or a fork). */
	source: { repo: string; branch: string; fork: boolean };
	target: { repo: string; branch: string };
	headSha: string | null;
	mergedSha: string | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	/** Checks on headSha, or null before any ran. */
	checks: PullChecks | null;
	/** The latest merge attempt (rebase, checks, conformance, fast-forward). */
	merge: PullMerge | null;
	/** #258: the decision from the repo's owners and members' latest reviews. */
	review: { decision: ReviewDecision; approvals: number };
	/** #258: the repo requires an approval before merging. */
	requireApproval: boolean;
	/** Why merging is not possible right now, or null. */
	mergeBlocked: string | null;
	/** The viewer may merge (target owners and members). */
	canMerge: boolean;
	/** The viewer may edit, close or reopen (the author, or target owners and members). */
	canEdit: boolean;
}

/** Git branch names we accept in requests (no leading dash, no '..', no control characters). */
export const isBranchName = (name: unknown): name is string =>
	typeof name === "string" && /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/.test(name) && !name.endsWith(".lock");

export function parsePullInput(input: { title?: unknown; body?: unknown }, partial: boolean): { error: string } | { title?: string; body?: string } {
	const out: { title?: string; body?: string } = {};
	if (input.title !== undefined || !partial) {
		if (typeof input.title !== "string" || !input.title.trim()) return { error: "A title is required." };
		if (input.title.trim().length > PULL_LIMITS.title) return { error: `The title is at most ${PULL_LIMITS.title} characters.` };
		out.title = input.title.trim();
	}
	if (input.body !== undefined) {
		if (typeof input.body !== "string") return { error: "The description is text." };
		if (input.body.length > PULL_LIMITS.body) return { error: `The description is at most ${PULL_LIMITS.body} characters.` };
		out.body = input.body.trim();
	}
	return out;
}

/** #258: reviews and comments. */
export type ReviewState = "commented" | "approved" | "changes_requested";
export type ReviewDecision = "approved" | "changes_requested" | null;

export const COMMENT_LIMIT = 10_000;

export interface PullComment {
	id: string;
	author: string;
	body: string;
	/** A line comment: file, line and side of the diff. */
	path: string | null;
	line: number | null;
	side: "old" | "new" | null;
	reviewId: string | null;
	createdAt: string;
	updatedAt: string;
	/** The viewer wrote it (may edit and delete it). */
	mine: boolean;
	/** The viewer may delete it (its author, or the repo's owners and members). */
	canDelete: boolean;
}

export interface PullReview {
	id: string;
	reviewer: string;
	state: ReviewState;
	body: string;
	headSha: string | null;
	/** From an owner or member of the repo (other than the author): it decides approval. */
	counts: boolean;
	createdAt: string;
}

/** The decision from each counting reviewer's latest review: any request for changes wins. */
export function reviewDecision(reviews: { reviewerId: string; state: ReviewState; counts: boolean; createdAt: string }[]): { decision: ReviewDecision; approvals: number } {
	const latest = new Map<string, ReviewState>();
	for (const r of [...reviews].filter((r) => r.counts && r.state !== "commented").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(r.reviewerId, r.state);
	const states = [...latest.values()];
	const approvals = states.filter((s) => s === "approved").length;
	return { decision: states.includes("changes_requested") ? "changes_requested" : approvals ? "approved" : null, approvals };
}
