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
	/** The latest merge attempt (rebase, checks, conformance, fast-forward). */
	merge: PullMerge | null;
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
