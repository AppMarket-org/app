import { ISSUE_LIMITS, type Issue, type IssueAssignee, type IssueComment, type IssueCloseReason, type IssuePriority, type IssueState, type IssueType, type IssueWork, parseIssueInput, redactSecrets, type Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AppSession, AuthVariables } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { canEdit, canView } from "../repos/access.ts";
import { nextNumber } from "../repos/numbers.ts";
import { RepoStore } from "../repos/repository.ts";
import { boardWork, syncIssueTask } from "./board.ts";

type Ctx = { Variables: AuthVariables };

interface IssueRow {
	id: string;
	repo_id: string;
	number: number;
	title: string;
	body: string;
	type: IssueType;
	priority: IssuePriority;
	assignee_id: string | null;
	assignee_handle: string | null;
	assignee_name: string | null;
	for_agents: number;
	state: IssueState;
	reason: IssueCloseReason | null;
	author_id: string;
	author: string | null;
	comments: number;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
}

const SELECT = `SELECT i.*, au.name AS author, ao.handle AS assignee_handle, asu.name AS assignee_name,
	(SELECT COUNT(*) FROM issue_comments c WHERE c.issue_id = i.id AND c.deleted_at IS NULL) AS comments
	FROM issues i LEFT JOIN "user" au ON au.id = i.author_id LEFT JOIN owners ao ON ao.user_id = i.assignee_id LEFT JOIN "user" asu ON asu.id = i.assignee_id`;

function toIssue(row: IssueRow, repo: Repo, session: AppSession | null, work: Map<string, IssueWork> = new Map()): Issue {
	const triage = canEdit(repo, session);
	const assignee: IssueAssignee | null = row.for_agents ? { kind: "agents" } : row.assignee_handle ? { kind: "user", handle: row.assignee_handle, name: row.assignee_name ?? row.assignee_handle } : null;
	return {
		number: row.number,
		title: row.title,
		body: row.body,
		type: row.type,
		priority: row.priority,
		state: row.state,
		reason: row.reason,
		assignee,
		author: row.author ?? "",
		comments: row.comments,
		work: work.get(row.id) ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at,
		canTriage: triage,
		canEdit: triage || row.author_id === session?.user.id,
	};
}

async function target(c: Context<Ctx>): Promise<Repo | null> {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo || repo.state === "removed" || !canView(repo, c.get("session"))) return null;
	c.header("Cache-Control", "private, no-store");
	return repo;
}

const issueRow = (repoId: string, number: number) => env.DB.prepare(`${SELECT} WHERE i.repo_id = ? AND i.number = ?`).bind(repoId, number).first<IssueRow>();
const notFound = (c: Context<Ctx>) => c.json({ error: "not_found" }, 404);
const invalid = (c: Context<Ctx>, message: string, status: 400 | 403 = 400) => c.json({ error: "invalid", message }, status);

/** "agents", or the user behind a handle who can edit the repo (its owner, or a member of its organization). */
async function resolveAssignee(repo: Repo, handle: string | null): Promise<{ assigneeId: string | null; forAgents: boolean } | { error: string }> {
	if (handle === null) return { assigneeId: null, forAgents: false };
	if (handle === "agents") return { assigneeId: null, forAgents: true };
	const user = await env.DB.prepare("SELECT user_id FROM owners WHERE handle = ? AND kind = 'user'").bind(handle).first<{ user_id: string }>();
	if (!user) return { error: `No one is called ${handle}.` };
	const member =
		user.user_id === repo.owner.id ||
		!!(await env.DB.prepare("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?").bind(repo.owner.id, user.user_id).first());
	return member ? { assigneeId: user.user_id, forAgents: false } : { error: `${handle} cannot work on ${repo.fullName}. Assign one of its owners or members, or Agents.` };
}

/**
 * #294: issues on a repo. Anyone who can see the repo reads them; its owners and members open,
 * triage (type, priority, assignee) and close them; authors edit their own title and description.
 * Mounted under /api/repos.
 */
export const issueRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/issues", async (c) => {
		const repo = await target(c);
		if (!repo) return notFound(c);
		const state = c.req.query("state") === "closed" ? "closed" : c.req.query("state") === "all" ? null : "open";
		const where = ["i.repo_id = ?"];
		const params: unknown[] = [repo.id];
		if (state) where.push("i.state = ?"), params.push(state);
		const type = c.req.query("type");
		if (type === "bug" || type === "feature" || type === "task") where.push("i.type = ?"), params.push(type);
		const assignee = c.req.query("assignee");
		if (assignee === "agents") where.push("i.for_agents = 1");
		else if (assignee) where.push("ao.handle = ?"), params.push(assignee);
		const { results } = await env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY i.number DESC LIMIT 100`)
			.bind(...params)
			.all<IssueRow>();
		const counts = await env.DB.prepare("SELECT state, COUNT(*) AS n FROM issues WHERE repo_id = ? GROUP BY state").bind(repo.id).all<{ state: IssueState; n: number }>();
		const session = c.get("session");
		const work = await boardWork(repo.id, results.filter((r) => r.for_agents === 1).map((r) => r.id));
		return c.json({ items: results.map((r) => toIssue(r, repo, session, work)), counts: Object.fromEntries(counts.results.map((r) => [r.state, r.n])) });
	})
	.post("/:owner/:slug/issues", async (c) => {
		const session = c.get("session");
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const repo = await target(c);
		if (!repo) return notFound(c);
		if (!canEdit(repo, session)) return invalid(c, "Only the repo's owners and members can open issues.", 403);
		const { success } = await env.RL_PULLS.limit({ key: session.user.id });
		if (!success) return c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
		const input = parseIssueInput(await c.req.json<Record<string, unknown>>().catch(() => ({})), false);
		if ("error" in input) return invalid(c, input.error);
		const who = await resolveAssignee(repo, input.assignee ?? null);
		if ("error" in who) return invalid(c, who.error);
		const id = crypto.randomUUID();
		const number = await nextNumber(env.DB, repo.id);
		await env.DB.prepare("INSERT INTO issues (id, repo_id, number, title, body, type, priority, assignee_id, for_agents, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(id, repo.id, number, redactSecrets(input.title!).text, redactSecrets(input.body ?? "").text, input.type ?? "task", input.priority ?? "none", who.assigneeId, who.forAgents ? 1 : 0, session.user.id)
			.run();
		logEvent("issue.opened", { repo: repo.fullName, number, type: input.type ?? "task", agents: who.forAgents });
		const created = (await issueRow(repo.id, number))!;
		if (who.forAgents) await syncIssueTask(created);
		return c.json(toIssue(created, repo, session, await boardWork(repo.id, who.forAgents ? [id] : [])), 201);
	})
	.get("/:owner/:slug/issues/:number{[0-9]+}", async (c) => {
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		return c.json(toIssue(row, repo, c.get("session"), await boardWork(repo.id, row.for_agents === 1 ? [row.id] : [])));
	})
	.patch("/:owner/:slug/issues/:number{[0-9]+}", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		const input = parseIssueInput(await c.req.json<Record<string, unknown>>().catch(() => ({})), true);
		if ("error" in input) return invalid(c, input.error);
		const triage = canEdit(repo, session);
		const editsText = input.title !== undefined || input.body !== undefined;
		const triages = input.type !== undefined || input.priority !== undefined || input.assignee !== undefined || input.state !== undefined || input.reason !== undefined;
		if ((editsText && !triage && row.author_id !== session.user.id) || (triages && !triage)) return invalid(c, "Only the repo's owners and members can change this.", 403);
		const sets: string[] = [];
		const params: unknown[] = [];
		const set = (column: string, value: unknown) => (sets.push(`${column} = ?`), params.push(value));
		if (input.title !== undefined) set("title", redactSecrets(input.title).text);
		if (input.body !== undefined) set("body", redactSecrets(input.body).text);
		if (input.type !== undefined) set("type", input.type);
		if (input.priority !== undefined) set("priority", input.priority);
		if (input.assignee !== undefined) {
			const who = await resolveAssignee(repo, input.assignee);
			if ("error" in who) return invalid(c, who.error);
			set("assignee_id", who.assigneeId);
			set("for_agents", who.forAgents ? 1 : 0);
		}
		const state = input.state ?? (input.reason ? "closed" : undefined);
		if (state === "closed" && row.state === "open") {
			set("state", "closed");
			set("reason", input.reason ?? "completed");
			set("closed_by", session.user.id);
			sets.push("closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
		} else if (state === "closed" && input.reason) set("reason", input.reason);
		else if (state === "open" && row.state === "closed") sets.push("state = 'open'", "reason = NULL", "closed_by = NULL", "closed_at = NULL");
		if (sets.length) {
			sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
			await env.DB.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`)
				.bind(...params, row.id)
				.run();
			if (state && state !== row.state) logEvent(state === "closed" ? "issue.closed" : "issue.reopened", { repo: repo.fullName, number: row.number });
		}
		const updated = (await issueRow(repo.id, row.number))!;
		// The board follows: on it while open and for agents, off it (unless already being worked on) otherwise.
		if (sets.length && (row.for_agents === 1 || updated.for_agents === 1)) await syncIssueTask(updated);
		return c.json(toIssue(updated, repo, session, await boardWork(repo.id, updated.for_agents === 1 ? [updated.id] : [])));
	})
	.get("/:owner/:slug/issues/:number{[0-9]+}/comments", async (c) => {
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		const session = c.get("session");
		const editor = canEdit(repo, session);
		const { results } = await env.DB.prepare(`SELECT c.*, u.name AS author FROM issue_comments c LEFT JOIN "user" u ON u.id = c.author_id WHERE c.issue_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at LIMIT 1000`)
			.bind(row.id)
			.all<{ id: string; author_id: string; author: string | null; body: string; created_at: string; updated_at: string }>();
		return c.json({
			items: results.map(
				(r): IssueComment => ({
					id: r.id,
					author: r.author ?? "",
					body: r.body,
					createdAt: r.created_at,
					updatedAt: r.updated_at,
					mine: r.author_id === session?.user.id,
					canDelete: r.author_id === session?.user.id || editor,
				}),
			),
		});
	})
	.post("/:owner/:slug/issues/:number{[0-9]+}/comments", async (c) => {
		const session = c.get("session");
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		// Anyone signed in who can see the repo may comment (as on pull requests).
		const { success } = await env.RL_PULLS.limit({ key: session.user.id });
		if (!success) return c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (typeof body.body !== "string" || !body.body.trim() || body.body.length > ISSUE_LIMITS.comment) return invalid(c, `A comment is 1 to ${ISSUE_LIMITS.comment} characters.`);
		const id = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare("INSERT INTO issue_comments (id, issue_id, author_id, body) VALUES (?, ?, ?, ?)").bind(id, row.id, session.user.id, redactSecrets(body.body.trim()).text),
			env.DB.prepare("UPDATE issues SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.id),
		]);
		return c.json({ id }, 201);
	})
	.patch("/:owner/:slug/issues/:number{[0-9]+}/comments/:id", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (typeof body.body !== "string" || !body.body.trim() || body.body.length > ISSUE_LIMITS.comment) return invalid(c, `A comment is 1 to ${ISSUE_LIMITS.comment} characters.`);
		const result = await env.DB.prepare("UPDATE issue_comments SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND issue_id = ? AND author_id = ? AND deleted_at IS NULL")
			.bind(redactSecrets(body.body.trim()).text, c.req.param("id"), row.id, session.user.id)
			.run();
		return result.meta.changes ? c.json({ ok: true }) : notFound(c);
	})
	.delete("/:owner/:slug/issues/:number{[0-9]+}/comments/:id", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await issueRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		const anyone = canEdit(repo, session);
		const result = await env.DB.prepare(`UPDATE issue_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND issue_id = ? AND deleted_at IS NULL ${anyone ? "" : "AND author_id = ?"}`)
			.bind(...(anyone ? [c.req.param("id"), row.id] : [c.req.param("id"), row.id, session.user.id]))
			.run();
		return result.meta.changes ? c.json({ ok: true }) : notFound(c);
	});
