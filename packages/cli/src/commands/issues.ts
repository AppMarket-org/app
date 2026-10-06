import { ApiError } from "../api.ts";
import { explainError as explainPullError, type PullContext } from "./pulls.ts";

/**
 * #297: issues from the CLI and agents. They live on the repo the work is for: this repo, or the
 * original repo from an agent session or a fork (the pull request target).
 */
export interface IssueView {
	number: number;
	title: string;
	body: string;
	type: "bug" | "feature" | "task";
	priority: string;
	state: "open" | "closed";
	reason: "completed" | "not_planned" | null;
	assignee: { kind: "user"; handle: string; name: string } | { kind: "agents" } | null;
	author: string;
	comments: number;
	createdAt: string;
	/** Older servers do not send it. */
	work?: { status: string; agent: string | null; pull: number | null } | null;
}

export interface IssueCommentView {
	author: string;
	body: string;
	createdAt: string;
}

const TYPE = { bug: "Bug", feature: "Feature", task: "Task" } as const;

export const issuePath = (ctx: PullContext, n?: number) => `/api/repos/${ctx.target}/issues${n === undefined ? "" : `/${n}`}`;

export function describeIssue(i: IssueView, origin: string, repo: string): string {
	const assignee = !i.assignee ? "no one" : i.assignee.kind === "agents" ? "Agents" : i.assignee.handle;
	const lines = [
		`#${i.number} ${i.title}  [${i.state === "open" ? "open" : i.reason === "not_planned" ? "closed: not planned" : "closed"}]`,
		`${TYPE[i.type]}${i.priority !== "none" ? ` · ${i.priority} priority` : ""} · assigned to ${assignee} · opened by ${i.author}`,
		`${origin}/${repo}/issues/${i.number}`,
	];
	if (i.work) {
		const who = i.work.agent ?? "an agent";
		const status = { open: "waiting for an agent", claimed: `${who} is working on it`, review: `in review${i.work.pull ? ` in pull request #${i.work.pull}` : ""}`, done: `${who} finished it`, failed: `${who} could not finish it` }[i.work.status] ?? i.work.status;
		lines.push(`Agents board: ${status}`);
	}
	return lines.join("\n");
}

export function describeIssueComments(items: IssueCommentView[]): string {
	return items.length ? items.map((c) => `${c.author} (${c.createdAt.slice(0, 16).replace("T", " ")}): ${c.body}`).join("\n\n") : "No comments yet.";
}

export function explainIssueError(error: unknown): string {
	if (error instanceof ApiError && error.status === 403 && (error.body as { error?: string } | null)?.error === "insufficient_scope") return "This sign-in cannot change issues: run `appmarket login` again.";
	return explainPullError(error);
}
