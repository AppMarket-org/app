import { COMMENT_LIMIT, PULL_LIMITS } from "./pulls";

/** #294: issues. Agent work is issues too: one assigned to Agents is a task on the Agents board (#296). */
export const ISSUE_TYPES = ["bug", "feature", "task"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export const ISSUE_TYPE_LABELS: Record<IssueType, { label: string; help: string }> = {
	bug: { label: "Bug", help: "An unexpected problem or behavior" },
	feature: { label: "Feature", help: "A request, idea, or new functionality" },
	task: { label: "Task", help: "A specific piece of work" },
};

export const ISSUE_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export type IssueState = "open" | "closed";
export type IssueCloseReason = "completed" | "not_planned";

/** A person (by handle), or any agent working on the repo's board. */
export type IssueAssignee = { kind: "user"; handle: string; name: string } | { kind: "agents" };

/** #296: an issue for agents, as its task on the Agents board stands. */
export interface IssueWork {
	/** open: waiting for an agent; claimed: an agent is on it; review: in a pull request; done, failed. */
	status: "open" | "claimed" | "review" | "done" | "failed";
	/** The agent working on it (or that did). */
	agent: string | null;
	/** The pull request with the work, when there is one. */
	pull: number | null;
}

export interface Issue {
	number: number;
	title: string;
	body: string;
	type: IssueType;
	priority: IssuePriority;
	state: IssueState;
	/** Why it was closed. */
	reason: IssueCloseReason | null;
	assignee: IssueAssignee | null;
	author: string;
	comments: number;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	/** Its task on the Agents board, when it is for agents (#296). */
	work: IssueWork | null;
	/** The viewer may change type, priority, assignee and state (the repo's owners and members). */
	canTriage: boolean;
	/** The viewer may edit the title and description (the author, or a triager). */
	canEdit: boolean;
}

export interface IssueComment {
	id: string;
	author: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	mine: boolean;
	canDelete: boolean;
}

export const ISSUE_LIMITS = { title: PULL_LIMITS.title, body: PULL_LIMITS.body, comment: COMMENT_LIMIT };

export interface IssueInput {
	title?: string;
	body?: string;
	type?: IssueType;
	priority?: IssuePriority;
	/** A handle, "agents", or null to unassign. */
	assignee?: string | null;
	state?: IssueState;
	reason?: IssueCloseReason;
}

/** Checks a new issue (partial = false) or a change to one (only the fields given). */
export type IssueInputRaw = { [K in keyof IssueInput]?: unknown };

export function parseIssueInput(input: IssueInputRaw, partial: boolean): { error: string } | IssueInput {
	const out: IssueInput = {};
	if (input.title !== undefined || !partial) {
		if (typeof input.title !== "string" || !input.title.trim()) return { error: "A title is required." };
		if (input.title.trim().length > ISSUE_LIMITS.title) return { error: `The title is at most ${ISSUE_LIMITS.title} characters.` };
		out.title = input.title.trim();
	}
	if (input.body !== undefined) {
		if (typeof input.body !== "string") return { error: "The description is text." };
		if (input.body.length > ISSUE_LIMITS.body) return { error: `The description is at most ${ISSUE_LIMITS.body} characters.` };
		out.body = input.body.trim();
	}
	if (input.type !== undefined) {
		if (!ISSUE_TYPES.includes(input.type as IssueType)) return { error: "type is bug, feature or task." };
		out.type = input.type as IssueType;
	}
	if (input.priority !== undefined) {
		if (!ISSUE_PRIORITIES.includes(input.priority as IssuePriority)) return { error: "priority is none, low, medium, high or urgent." };
		out.priority = input.priority as IssuePriority;
	}
	if (input.assignee !== undefined) {
		if (input.assignee !== null && (typeof input.assignee !== "string" || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(input.assignee))) return { error: 'assignee is a handle, "agents", or null.' };
		out.assignee = input.assignee === null ? null : (input.assignee as string).toLowerCase();
	}
	if (input.state !== undefined) {
		if (input.state !== "open" && input.state !== "closed") return { error: "state is open or closed." };
		out.state = input.state;
	}
	if (input.reason !== undefined) {
		if (input.reason !== "completed" && input.reason !== "not_planned") return { error: "reason is completed or not_planned." };
		out.reason = input.reason;
	}
	return out;
}
