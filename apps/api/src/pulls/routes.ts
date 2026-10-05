import { isBranchName, parsePullInput, type PullMerge, type PullRequest, type PullState, redactSecrets, type Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { listBranches } from "../artifacts/git.ts";
import type { AppSession, AuthVariables } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { startMerge } from "../plane/merge.ts";
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

async function toPull(row: PullRow, repo: Repo, session: AppSession | null): Promise<PullRequest> {
	const editor = canEdit(repo, session);
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
	.post("/:owner/:slug/pulls/:number{[0-9]+}/merge", async (c) => {
		const session = c.get("session");
		const repo = await target(c);
		const row = repo ? await pullRow(repo.id, Number(c.req.param("number"))) : null;
		if (!repo || !row) return notFound(c);
		if (!canEdit(repo, session)) return invalid(c, "Only the repo's owners and members can merge.", 403);
		if (row.state !== "open") return invalid(c, `The pull request is ${row.state}.`, 409);
		await startMerge({ repo, sourceRepoId: row.source_repo_id, branch: row.source_branch, pullId: row.id, baseBranch: row.target_branch });
		logEvent("pull.merge_requested", { repo: repo.fullName, number: row.number });
		return c.json(await toPull((await pullRow(repo.id, row.number))!, repo, session), 202);
	});
