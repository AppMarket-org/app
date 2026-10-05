import { COMMENT_LIMIT, isBranchName, parsePullInput, type PullComment, type PullMerge, type PullRequest, type PullReview, type PullState, type ReviewState, redactSecrets, type Repo, reviewDecision } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { listBranches } from "../artifacts/git.ts";
import type { AppSession, AuthVariables } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { normalizePath } from "../plane/model.ts";
import { startMerge } from "../plane/merge.ts";
import { changedFiles, diffRange, fileDiff } from "./diff.ts";
import { notifyPull, participants, repoOwners } from "./notify.ts";
import { canEdit, canView } from "../repos/access.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import { RepoStore } from "../repos/repository.ts";

type Ctx = { Variables: AuthVariables };

interface PullRow {
	id: string;
	repo_id: string;
	number: number;
	title: string;
	body: string;
	author_id: string;
	author: string | null;
	source_repo_id: string;
	source_name: string;
	source_branch: string;
	target_branch: string;
	state: PullState;
	head_sha: string | null;
	merged_sha: string | null;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
}

const SELECT = `SELECT p.*, u.name AS author, so.handle || '/' || s.slug AS source_name
	FROM pull_requests p JOIN repos s ON s.id = p.source_repo_id JOIN owners so ON so.id = s.owner_id LEFT JOIN "user" u ON u.id = p.author_id`;

async function latestMerge(pullId: string): Promise<PullMerge | null> {
	const m = await env.DB.prepare("SELECT id, status, head_sha, error, details FROM merges WHERE pull_id = ? ORDER BY created_at DESC LIMIT 1")
		.bind(pullId)
		.first<{ id: string; status: PullMerge["status"]; head_sha: string | null; error: string | null; details: string | null }>();
	if (!m) return null;
	const conflicts = m.status === "conflict" && m.details ? ((JSON.parse(m.details) as { conflicts?: string[] }).conflicts ?? []) : undefined;
	return { id: m.id, status: m.status, sha: m.head_sha, error: m.error, ...(conflicts ? { conflicts } : {}) };
}

async function reviewsOf(pullId: string) {
	const { results } = await env.DB.prepare("SELECT reviewer_id, state, counts, created_at FROM pull_reviews WHERE pull_id = ?")
		.bind(pullId)
		.all<{ reviewer_id: string; state: ReviewState; counts: number; created_at: string }>();
	return reviewDecision(results.map((r) => ({ reviewerId: r.reviewer_id, state: r.state, counts: r.counts === 1, createdAt: r.created_at })));
}

const requiresApproval = async (repoId: string) =>
	(await env.DB.prepare("SELECT require_approval FROM repo_pull_settings WHERE repo_id = ?").bind(repoId).first<{ require_approval: number }>())?.require_approval === 1;

/** Why the pull request cannot be merged now (null when it can). */
function blocked(state: PullState, review: { decision: string | null }, requireApproval: boolean): string | null {
	if (state !== "open") return `The pull request is ${state}.`;
	if (review.decision === "changes_requested") return "Changes were requested.";
	if (requireApproval && review.decision !== "approved") return "This repo requires an approval before merging.";
	return null;
}

async function toPull(row: PullRow, repo: Repo, session: AppSession | null): Promise<PullRequest> {
	const editor = canEdit(repo, session);
	const [review, requireApproval] = await Promise.all([reviewsOf(row.id), requiresApproval(repo.id)]);
	return {
		number: row.number,
		title: row.title,
		body: row.body,
		state: row.state,
		author: row.author ?? "",
		source: { repo: row.source_name, branch: row.source_branch, fork: row.source_repo_id !== row.repo_id },
		target: { repo: repo.fullName, branch: row.target_branch },
		headSha: row.head_sha,
		mergedSha: row.merged_sha,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at,
		merge: await latestMerge(row.id),
		review,
		requireApproval,
		mergeBlocked: blocked(row.state, review, requireApproval),
		canMerge: editor && row.state === "open",
		canEdit: editor || row.author_id === session?.user.id,
	};
}

async function target(c: Context<Ctx>): Promise<Repo | null> {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	if (!repo?.gitRepo || repo.state === "removed" || !canView(repo, c.get("session"))) return null;
	c.header("Cache-Control", "private, no-store");
	return repo;
}

const pullRow = (repoId: string, number: number) => env.DB.prepare(`${SELECT} WHERE p.repo_id = ? AND p.number = ?`).bind(repoId, number).first<PullRow>();

const notFound = (c: Context<Ctx>) => c.json({ error: "not_found" }, 404);
const invalid = (c: Context<Ctx>, message: string, status: 400 | 403 | 409 = 400) => c.json({ error: status === 409 ? "conflict" : "invalid", message }, status);

/** Keeps head_sha current while the pull request is open (the source branch may have moved). */
async function refreshHead(row: PullRow): Promise<PullRow> {
	if (row.state !== "open") return row;
	const source = await env.DB.prepare("SELECT git_repo FROM repos WHERE id = ?").bind(row.source_repo_id).first<{ git_repo: string | null }>();
	if (!source?.git_repo) return row;
	const head = (await listBranches(source.git_repo).catch(() => null))?.branches.find((b) => b.name === row.source_branch)?.sha ?? null;
	if (head && head !== row.head_sha) {
		await env.DB.prepare("UPDATE pull_requests SET head_sha = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(head, row.id).run();
		return { ...row, head_sha: head };
	}
	return row;
}

function commentInput(body: Record<string, unknown>): { error: string } | { body: string; path: string | null; line: number | null; side: "old" | "new" | null } {
	if (typeof body.body !== "string" || !body.body.trim() || body.body.length > COMMENT_LIMIT) return { error: `A comment is 1 to ${COMMENT_LIMIT} characters.` };
	if (body.path === undefined || body.path === null) return { body: body.body.trim(), path: null, line: null, side: null };
	const path = typeof body.path === "string" ? normalizePath(body.path) : null;
	if (!path || path.endsWith("/")) return { error: "path is a file of the diff." };
	if (!Number.isInteger(body.line) || (body.line as number) < 1) return { error: "line is a line number." };
	if (body.side !== "old" && body.side !== "new") return { error: "side is old or new." };
	return { body: body.body.trim(), path, line: body.line as number, side: body.side };
}

async function forDiff(repo: Repo, row: PullRow) {
	const source = await env.DB.prepare("SELECT git_repo FROM repos WHERE id = ?").bind(row.source_repo_id).first<{ git_repo: string | null }>();
	return { id: row.id, state: row.state, target_branch: row.target_branch, source_branch: row.source_branch, head_sha: row.head_sha, target_git: repo.gitRepo!, source_git: source?.git_repo ?? null };
}

/**
 * #256: pull requests on a repo. Anyone who can see the repo sees them; whoever can push to the
 * source (this repo's owners and members, or a fork's) opens one; the target's owners and members
 * merge. Mounted under /api/repos.
 */
export const pullRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/pulls", async (c) => {
		const repo = await target(c);
		if (!repo) return notFound(c);
		const state = c.req.query("state") ?? "open";
		const filter = state === "all" ? "" : "AND p.state = ?";
		const { results } = await env.DB.prepare(`${SELECT} WHERE p.repo_id = ? ${filter} ORDER BY p.number DESC LIMIT 100`)
			.bind(...(state === "all" ? [repo.id] : [repo.id, ["open", "closed", "merged"].includes(state) ? state : "open"]))
			.all<PullRow>();
		const counts = await env.DB.prepare("SELECT state, COUNT(*) AS n FROM pull_requests WHERE repo_id = ? GROUP BY state").bind(repo.id).all<{ state: PullState; n: number }>();
		return c.json({
			items: await Promise.all(results.map((r) => toPull(r, repo, c.get("session")))),
			counts: Object.fromEntries(counts.results.map((r) => [r.state, r.n])),
		});
	})
	.post("/:owner/:slug/pulls", async (c) => {
		const session = c.get("session");
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const repo = await target(c);
		if (!repo) return notFound(c);
		const { success } = await env.RL_PULLS.limit({ key: session.user.id });
		if (!success) return c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const input = parsePullInput(body, false);
		if ("error" in input) return invalid(c, input.error);
		if (!isBranchName(body.sourceBranch)) return invalid(c, "sourceBranch is a branch name.");
		if (body.targetBranch !== undefined && !isBranchName(body.targetBranch)) return invalid(c, "targetBranch is a branch name.");

		// The source: this repo, or a fork of it (Use this template, or an agent session's fork).
		const store = new RepoStore(env.DB);
		let source: Repo | null = repo;
		if (typeof body.source === "string" && body.source && body.source !== repo.fullName) {
			const [owner, slug] = body.source.split("/");
			source = owner && slug ? await store.findByPath(owner, slug) : null;
			if (!source?.gitRepo || source.state === "removed") return invalid(c, "The source repo does not exist.");
			const links = await env.DB.prepare("SELECT forked_from, session_of FROM repos WHERE id = ?").bind(source.id).first<{ forked_from: string | null; session_of: string | null }>();
			if (links?.forked_from !== repo.id && links?.session_of !== repo.id) return invalid(c, `${source.fullName} is not a fork of ${repo.fullName}.`);
		}
		if (!canEdit(source, session)) return invalid(c, "You can open pull requests only from repos you can push to.", 403);

		const [from, into] = await Promise.all([listBranches(source.gitRepo!), source.id === repo.id ? null : listBranches(repo.gitRepo!)]);
		const targets = into ?? from;
		const head = from.branches.find((b) => b.name === body.sourceBranch);
		if (!head) return invalid(c, `${String(body.sourceBranch)} does not exist in ${source.fullName}.`);
		const base = typeof body.targetBranch === "string" ? targets.branches.find((b) => b.name === body.targetBranch) : pickBranch(targets.defaultBranch, targets.branches);
		if (!base) return invalid(c, typeof body.targetBranch === "string" ? `${body.targetBranch} does not exist in ${repo.fullName}.` : `${repo.fullName} has no branches yet.`);
		if (source.id === repo.id && base.name === head.name) return invalid(c, "Pick a different branch to merge from.");
		if (head.sha === base.sha) return invalid(c, `${head.name} has nothing that ${base.name} does not.`);
		const existing = await env.DB.prepare("SELECT number FROM pull_requests WHERE repo_id = ? AND source_repo_id = ? AND source_branch = ? AND target_branch = ? AND state = 'open'")
			.bind(repo.id, source.id, head.name, base.name)
			.first<{ number: number }>();
		if (existing) return c.json({ error: "conflict", message: `Pull request #${existing.number} is already open for this branch.`, number: existing.number }, 409);

		const id = crypto.randomUUID();
		const text = redactSecrets(input.body ?? "").text;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await env.DB.prepare(
					`INSERT INTO pull_requests (id, repo_id, number, title, body, author_id, source_repo_id, source_branch, target_branch, head_sha)
					 VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM pull_requests WHERE repo_id = ?), ?, ?, ?, ?, ?, ?, ?)`,
				)
					.bind(id, repo.id, repo.id, redactSecrets(input.title!).text, text, session.user.id, source.id, head.name, base.name, head.sha)
					.run();
				break;
			} catch (error) {
				if (attempt === 2 || !String(error).includes("UNIQUE")) throw error;
			}
		}
		const row = (await env.DB.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PullRow>())!;
		logEvent("pull.opened", { repo: repo.fullName, number: row.number, fork: source.id !== repo.id });
		c.executionCtx.waitUntil(
			repoOwners(repo.owner.id)
				.then((owners) => notifyPull({ repo: repo.fullName, number: row.number, title: row.title, actorId: session.user.id, actor: session.user.name, what: "opened a pull request", excerpt: row.body, userIds: owners }))
				.catch(() => undefined),
		);
		return c.json(await toPull(row, repo, session), 201);
	})
	.get("/:owner/:slug/pulls/:number{[0-9]+}", async (c) => {
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		return c.json(await toPull(await refreshHead(row), repo, c.get("session")));
	})
	.patch("/:owner/:slug/pulls/:number{[0-9]+}", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		if (!canEdit(repo, session) && row.author_id !== session.user.id) return invalid(c, "Only the author and the repo's owners and members can change it.", 403);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const input = parsePullInput(body, true);
		if ("error" in input) return invalid(c, input.error);
		let state = row.state;
		if (body.state !== undefined) {
			if (row.state === "merged") return invalid(c, "A merged pull request stays merged.", 409);
			if (body.state !== "open" && body.state !== "closed") return invalid(c, "state is open or closed.");
			state = body.state;
		}
		await env.DB.prepare(
			`UPDATE pull_requests SET title = ?, body = ?, state = ?, closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
			 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
		)
			.bind(input.title !== undefined ? redactSecrets(input.title).text : row.title, input.body !== undefined ? redactSecrets(input.body).text : row.body, state, state, row.id)
			.run();
		return c.json(await toPull(await refreshHead((await pullRow(repo.id, row.number))!), repo, session));
	})
	// #257: the diff: commits and files changed, and one file's hunks.
	.get("/:owner/:slug/pulls/:number{[0-9]+}/files", async (c) => {
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		const range = await diffRange(await forDiff(repo, await refreshHead(row)));
		if (!range) return c.json({ error: "unavailable", message: "The branches of this pull request are gone or share no history." }, 409);
		return c.json({ base: range.base, head: range.head, commits: range.commits, ...(await changedFiles(range)) });
	})
	.get("/:owner/:slug/pulls/:number{[0-9]+}/diff", async (c) => {
		const path = normalizePath(c.req.query("path") ?? "");
		if (!path || path.endsWith("/")) return invalid(c, "path is a file.");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		const range = await diffRange(await forDiff(repo, row));
		const diff = range ? await fileDiff(range, path) : null;
		return diff ? c.json({ base: range!.base, head: range!.head, ...diff }) : notFound(c);
	})
	// #258: conversation and line comments, and reviews.
	.get("/:owner/:slug/pulls/:number{[0-9]+}/comments", async (c) => {
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		const session = c.get("session");
		const editor = canEdit(repo, session);
		const [comments, reviews] = await Promise.all([
			env.DB.prepare(`SELECT c.*, u.name AS author FROM pull_comments c LEFT JOIN "user" u ON u.id = c.author_id WHERE c.pull_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at LIMIT 1000`)
				.bind(row.id)
				.all<{ id: string; author_id: string; author: string | null; body: string; path: string | null; line: number | null; side: "old" | "new" | null; review_id: string | null; created_at: string; updated_at: string }>(),
			env.DB.prepare(`SELECT r.*, u.name AS reviewer FROM pull_reviews r LEFT JOIN "user" u ON u.id = r.reviewer_id WHERE r.pull_id = ? ORDER BY r.created_at LIMIT 500`)
				.bind(row.id)
				.all<{ id: string; reviewer: string | null; state: ReviewState; body: string; head_sha: string | null; counts: number; created_at: string }>(),
		]);
		return c.json({
			comments: comments.results.map(
				(r): PullComment => ({
					id: r.id,
					author: r.author ?? "",
					body: r.body,
					path: r.path,
					line: r.line,
					side: r.side,
					reviewId: r.review_id,
					createdAt: r.created_at,
					updatedAt: r.updated_at,
					mine: r.author_id === session?.user.id,
					canDelete: r.author_id === session?.user.id || editor,
				}),
			),
			reviews: reviews.results.map((r): PullReview => ({ id: r.id, reviewer: r.reviewer ?? "", state: r.state, body: r.body, headSha: r.head_sha, counts: r.counts === 1, createdAt: r.created_at })),
		});
	})
	.post("/:owner/:slug/pulls/:number{[0-9]+}/comments", async (c) => {
		const session = c.get("session");
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		const { success } = await env.RL_PULLS.limit({ key: session.user.id });
		if (!success) return c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const comment = commentInput(body);
		if ("error" in comment) return invalid(c, comment.error);
		const id = crypto.randomUUID();
		await env.DB.prepare("INSERT INTO pull_comments (id, pull_id, author_id, body, path, line, side) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.bind(id, row.id, session.user.id, redactSecrets(comment.body).text, comment.path, comment.line, comment.side)
			.run();
		await env.DB.prepare("UPDATE pull_requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.id).run();
		c.executionCtx.waitUntil(
			participants(row.id, row.author_id)
				.then((ids) =>
					notifyPull({ repo: repo.fullName, number: row.number, title: row.title, actorId: session.user.id, actor: session.user.name, what: comment.path ? `commented on ${comment.path}` : "commented", excerpt: comment.body, userIds: ids }),
				)
				.catch(() => undefined),
		);
		return c.json({ id }, 201);
	})
	.patch("/:owner/:slug/pulls/:number{[0-9]+}/comments/:id", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (typeof body.body !== "string" || !body.body.trim() || body.body.length > COMMENT_LIMIT) return invalid(c, `A comment is 1 to ${COMMENT_LIMIT} characters.`);
		const result = await env.DB.prepare(
			"UPDATE pull_comments SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND pull_id = ? AND author_id = ? AND deleted_at IS NULL",
		)
			.bind(redactSecrets(body.body.trim()).text, c.req.param("id"), row.id, session.user.id)
			.run();
		return result.meta.changes ? c.json({ ok: true }) : notFound(c);
	})
	.delete("/:owner/:slug/pulls/:number{[0-9]+}/comments/:id", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row || !session) return notFound(c);
		const anyone = canEdit(repo, session);
		const result = await env.DB.prepare(
			`UPDATE pull_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND pull_id = ? AND deleted_at IS NULL ${anyone ? "" : "AND author_id = ?"}`,
		)
			.bind(...(anyone ? [c.req.param("id"), row.id] : [c.req.param("id"), row.id, session.user.id]))
			.run();
		return result.meta.changes ? c.json({ ok: true }) : notFound(c);
	})
	.post("/:owner/:slug/pulls/:number{[0-9]+}/reviews", async (c) => {
		const session = c.get("session");
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		if (row.state !== "open") return invalid(c, `The pull request is ${row.state}.`, 409);
		const { success } = await env.RL_PULLS.limit({ key: session.user.id });
		if (!success) return c.json({ error: "rate_limited", retryAfter: 60 }, 429, { "Retry-After": "60" });
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		const state = ({ comment: "commented", approve: "approved", request_changes: "changes_requested" } as const)[String(body.event) as "comment" | "approve" | "request_changes"];
		if (!state) return invalid(c, "event is comment, approve or request_changes.");
		const text = typeof body.body === "string" ? body.body.trim() : "";
		if (text.length > COMMENT_LIMIT) return invalid(c, `A review is at most ${COMMENT_LIMIT} characters.`);
		if (state !== "approved" && !text && !Array.isArray(body.comments)) return invalid(c, "Say what to change, or add line comments.");
		if (state !== "commented" && row.author_id === session.user.id) return invalid(c, "You cannot approve or request changes on your own pull request.", 403);
		const lines = Array.isArray(body.comments) ? body.comments.slice(0, 100).map((x) => commentInput((x ?? {}) as Record<string, unknown>)) : [];
		const bad = lines.find((l) => "error" in l);
		if (bad && "error" in bad) return invalid(c, bad.error);
		const id = crypto.randomUUID();
		const counts = canEdit(repo, session) && row.author_id !== session.user.id;
		await env.DB.batch([
			env.DB.prepare("INSERT INTO pull_reviews (id, pull_id, reviewer_id, state, body, head_sha, counts) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
				id,
				row.id,
				session.user.id,
				state,
				redactSecrets(text).text,
				row.head_sha,
				counts ? 1 : 0,
			),
			...lines.map((l) => {
				const x = l as Exclude<typeof l, { error: string }>;
				return env.DB.prepare("INSERT INTO pull_comments (id, pull_id, author_id, body, path, line, side, review_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
					crypto.randomUUID(),
					row.id,
					session.user.id,
					redactSecrets(x.body).text,
					x.path,
					x.line,
					x.side,
					id,
				);
			}),
			env.DB.prepare("UPDATE pull_requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.id),
		]);
		const what = { commented: "reviewed", approved: "approved", changes_requested: "requested changes" }[state];
		c.executionCtx.waitUntil(
			participants(row.id, row.author_id)
				.then((ids) => notifyPull({ repo: repo.fullName, number: row.number, title: row.title, actorId: session.user.id, actor: session.user.name, what, excerpt: text, userIds: ids }))
				.catch(() => undefined),
		);
		return c.json(await toPull((await pullRow(repo.id, row.number))!, repo, session), 201);
	})
	.post("/:owner/:slug/pulls/:number{[0-9]+}/merge", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		if (!canEdit(repo, session)) return invalid(c, "Only the repo's owners and members can merge.", 403);
		const why = blocked(row.state, await reviewsOf(row.id), await requiresApproval(repo.id));
		if (why) return invalid(c, why, 409);
		await startMerge({ repo, sourceRepoId: row.source_repo_id, branch: row.source_branch, pullId: row.id, baseBranch: row.target_branch });
		logEvent("pull.merge_requested", { repo: repo.fullName, number: row.number });
		return c.json(await toPull((await pullRow(repo.id, row.number))!, repo, session), 202);
	})
	// #259: where the viewer can propose changes from: this repo (owners and members) and their forks of it.
	.get("/:owner/:slug/pulls/sources", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		if (!repo || !session) return notFound(c);
		const self = await env.DB.prepare("SELECT id FROM owners WHERE user_id = ?").bind(session.user.id).first<{ id: string }>();
		const mine = [self?.id, ...session.orgIds].filter((x): x is string => !!x);
		const { results: forks } = await env.DB.prepare(
			`SELECT r.id, o.handle || '/' || r.slug AS full_name, r.git_repo, r.session_of FROM repos r JOIN owners o ON o.id = r.owner_id
			 WHERE (r.forked_from = ? OR r.session_of = ?) AND r.state != 'removed' AND r.git_repo IS NOT NULL AND r.owner_id IN (${mine.map(() => "?").join(",") || "''"})
			 ORDER BY r.created_at DESC LIMIT 10`,
		)
			.bind(repo.id, repo.id, ...mine)
			.all<{ id: string; full_name: string; git_repo: string; session_of: string | null }>();
		const candidates = [...(canEdit(repo, session) ? [{ fullName: repo.fullName, gitRepo: repo.gitRepo!, fork: false, session: false }] : []), ...forks.map((f) => ({ fullName: f.full_name, gitRepo: f.git_repo, fork: true, session: !!f.session_of }))];
		const sources = await Promise.all(
			candidates.map(async (r) => {
				const b = await listBranches(r.gitRepo).catch(() => ({ defaultBranch: "", branches: [] as { name: string }[] }));
				return { repo: r.fullName, fork: r.fork, session: r.session, defaultBranch: b.defaultBranch, branches: b.branches.map((x) => x.name).sort() };
			}),
		);
		const targetBranches = await listBranches(repo.gitRepo!);
		return c.json({ sources, target: { defaultBranch: pickBranch(targetBranches.defaultBranch, targetBranches.branches)?.name ?? targetBranches.defaultBranch, branches: targetBranches.branches.map((b) => b.name).sort() } });
	})
	// #259: the diff a pull request would have, before opening it.
	.get("/:owner/:slug/compare", async (c) => {
		const repo = await target(c);
		if (!repo) return notFound(c);
		const sourceName = c.req.query("source") || repo.fullName;
		const branch = c.req.query("branch");
		const into = c.req.query("target");
		if (!isBranchName(branch) || !isBranchName(into)) return invalid(c, "branch and target are branch names.");
		let source: Repo | null = repo;
		if (sourceName !== repo.fullName) {
			const [o, s] = sourceName.split("/");
			source = o && s ? await new RepoStore(env.DB).findByPath(o, s) : null;
			const links = source ? await env.DB.prepare("SELECT forked_from, session_of FROM repos WHERE id = ?").bind(source.id).first<{ forked_from: string | null; session_of: string | null }>() : null;
			if (!source?.gitRepo || (links?.forked_from !== repo.id && links?.session_of !== repo.id) || !canView(source, c.get("session"))) return notFound(c);
		}
		const head = (await listBranches(source.gitRepo!)).branches.find((b) => b.name === branch)?.sha;
		if (!head) return invalid(c, `${branch} does not exist in ${source.fullName}.`);
		const range = await diffRange({ id: "", state: "open", target_branch: into, source_branch: branch, head_sha: head, target_git: repo.gitRepo!, source_git: source.gitRepo! });
		if (!range) return c.json({ error: "unavailable", message: "These branches share no history." }, 409);
		return c.json({ base: range.base, head: range.head, commits: range.commits, ...(await changedFiles(range)) });
	})
	// #258: the repo's merge rule.
	.get("/:owner/:slug/pull-settings", async (c) => {
		const repo = await target(c);
		if (!repo || !canEdit(repo, c.get("session"))) return notFound(c);
		return c.json({ requireApproval: await requiresApproval(repo.id) });
	})
	.put("/:owner/:slug/pull-settings", async (c) => {
		const repo = await target(c);
		if (!repo || !canEdit(repo, c.get("session"))) return notFound(c);
		const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
		if (typeof body.requireApproval !== "boolean") return invalid(c, "requireApproval is true or false.");
		await env.DB.prepare("INSERT INTO repo_pull_settings (repo_id, require_approval) VALUES (?, ?) ON CONFLICT (repo_id) DO UPDATE SET require_approval = excluded.require_approval")
			.bind(repo.id, body.requireApproval ? 1 : 0)
			.run();
		return c.json({ requireApproval: body.requireApproval });
	});
