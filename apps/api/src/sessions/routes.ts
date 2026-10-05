import { AGENT_HARNESSES, type AgentSession, type AgentSessionToken, MAX_ACTIVE_SESSIONS, SESSION_TOKEN_TTL } from "@appmarket/shared";
import { repoInputSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { deleteGitRepo, forkGitRepo, gitRepoNameFor, mintGitToken, revokeAllGitTokens } from "../artifacts/git.ts";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { publicRemote } from "../git/remote.ts";
import { logEvent } from "../observability/log.ts";
import { leavePlane } from "../plane/routes.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { strictHit } from "../strict-limit.ts";

type Ctx = { Variables: AuthVariables };

interface SessionRow {
	id: string;
	repo_id: string;
	fork_repo_id: string;
	user_id: string;
	harness: AgentSession["harness"];
	status: AgentSession["status"];
	token_expires_at: string;
	created_at: string;
	ended_at: string | null;
	repo: string;
	fork: string;
	started_by: string;
	fork_git_repo: string | null;
}

const SELECT = `SELECT s.*, ro.handle || '/' || r.slug AS repo, fo.handle || '/' || f.slug AS fork, f.git_repo AS fork_git_repo, u.name AS started_by
	FROM agent_sessions s JOIN repos r ON r.id = s.repo_id JOIN owners ro ON ro.id = r.owner_id
	JOIN repos f ON f.id = s.fork_repo_id JOIN owners fo ON fo.id = f.owner_id JOIN "user" u ON u.id = s.user_id`;

const toSession = (r: SessionRow): AgentSession => ({
	id: r.id,
	repo: r.repo,
	fork: r.fork,
	harness: r.harness,
	status: r.status,
	startedBy: r.started_by,
	tokenExpiresAt: r.token_expires_at,
	createdAt: r.created_at,
	endedAt: r.ended_at,
});

const findSession = (id: string) => env.DB.prepare(`${SELECT} WHERE s.id = ?`).bind(id).first<SessionRow>();

/** The session if the signed-in user may manage it: whoever started it, or anyone who can edit its repo. */
async function manageable(c: Context<Ctx>): Promise<SessionRow | null> {
	const row = await findSession(c.req.param("id")!);
	if (!row) return null;
	const session = c.get("session")!;
	if (row.user_id === session.user.id) return row;
	const repo = await new RepoStore(env.DB).findById(row.repo_id);
	return repo && canEdit(repo, session) ? row : null;
}

async function issueToken(row: SessionRow, gitRepo: string): Promise<AgentSessionToken> {
	const minted = await mintGitToken(gitRepo, "write", SESSION_TOKEN_TTL);
	await env.DB.prepare("UPDATE agent_sessions SET token_expires_at = ? WHERE id = ?").bind(minted.expiresAt, row.id).run();
	return { session: toSession({ ...row, token_expires_at: minted.expiresAt }), remote: publicRemote(row.fork), token: minted.token, expiresAt: minted.expiresAt };
}

/** #29 (R9): start and list a repo's agent sessions. Mounted under /api/repos. */
export const repoSessionRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/sessions", requireRole(), async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const { results } = await env.DB.prepare(`${SELECT} WHERE s.repo_id = ? ORDER BY s.created_at DESC LIMIT 50`).bind(repo.id).all<SessionRow>();
		return c.json({ items: results.map(toSession) });
	})
	.post("/:owner/:slug/sessions", requireRole(), async (c) => {
		const store = new RepoStore(env.DB);
		const source = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!source || !canEdit(source, session)) return c.json({ error: "not_found" }, 404);
		if (source.state === "removed" || !source.gitRepo) return c.json({ error: "removed" }, 409);
		if (source.sessionOf) return c.json({ error: "invalid", message: "Start sessions from the repo, not from another session's fork." }, 400);
		const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { harness?: unknown };
		const harness = AGENT_HARNESSES.find((h) => h === body.harness) ?? "other";
		const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_sessions WHERE repo_id = ? AND status = 'active'").bind(source.id).first<{ n: number }>();
		if ((active?.n ?? 0) >= MAX_ACTIVE_SESSIONS) return c.json({ error: "too_many_sessions", message: `This repo already has ${MAX_ACTIVE_SESSIONS} active sessions; end some first.`, limit: MAX_ACTIVE_SESSIONS }, 409);
		const limit = await strictHit("REPO_CREATE", session.user.id);
		if (!limit.success) {
			c.header("Retry-After", String(limit.retryAfter));
			return c.json({ error: "rate_limited", retryAfter: limit.retryAfter }, 429);
		}

		const id = crypto.randomUUID();
		const ids = await store.reserve(source.owner.id, `${source.name} session ${id.slice(0, 8)}`);
		const gitRepo = gitRepoNameFor(ids.slug, ids.id);
		await forkGitRepo(source.gitRepo, gitRepo);
		try {
			const input = repoInputSchema.parse({ name: `${source.name} session ${id.slice(0, 8)}`.slice(0, 80), summary: source.summary, description: "", category: source.category, runtime: source.runtime, platforms: source.platforms, license: source.license });
			const fork = await store.insert(ids, source.owner.id, session.user.id, input, gitRepo);
			await store.setSessionOf(fork.id, source.id);
			await env.DB.prepare("INSERT INTO agent_sessions (id, repo_id, fork_repo_id, user_id, harness, token_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
				.bind(id, source.id, fork.id, session.user.id, harness, new Date().toISOString())
				.run();
		} catch (error) {
			await deleteGitRepo(gitRepo).catch(() => undefined);
			throw error;
		}
		const row = (await findSession(id))!;
		logEvent("agent_session.started", { session: id, repo: source.fullName, fork: row.fork, harness, user: session.user.id });
		c.header("Cache-Control", "no-store");
		return c.json(await issueToken(row, gitRepo), 201);
	});

/** #29: renew, end or discard one session. Mounted under /api/sessions. */
export const agentSessionRoutes = new Hono<Ctx>()
	.use(requireRole())
	.post("/:id/token", async (c) => {
		const row = await manageable(c);
		if (!row) return c.json({ error: "not_found" }, 404);
		// Only the person who started it renews it: a teammate cannot take over someone's agent session.
		if (row.user_id !== c.get("session")!.user.id) return c.json({ error: "forbidden" }, 403);
		if (row.status !== "active" || !row.fork_git_repo) return c.json({ error: "ended", message: "This session has ended." }, 409);
		logEvent("agent_session.token_renewed", { session: row.id });
		c.header("Cache-Control", "no-store");
		return c.json(await issueToken(row, row.fork_git_repo));
	})
	.post("/:id/end", async (c) => {
		const row = await manageable(c);
		if (!row) return c.json({ error: "not_found" }, 404);
		if (row.status === "active" && row.fork_git_repo) await revokeAllGitTokens(row.fork_git_repo);
		await env.DB.prepare("UPDATE agent_sessions SET status = 'ended', ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ? AND status = 'active'").bind(row.id).run();
		// #236: the agent leaves the collaboration board; tasks it claimed but did not finish reopen.
		await leavePlane(row.repo_id, row.id).catch(() => undefined);
		logEvent("agent_session.ended", { session: row.id });
		return c.json(toSession((await findSession(row.id))!));
	})
	.delete("/:id", async (c) => {
		const row = await manageable(c);
		if (!row) return c.json({ error: "not_found" }, 404);
		// Discarding removes the fork: its tokens are revoked and its Git repository deleted.
		if (row.fork_git_repo) {
			await revokeAllGitTokens(row.fork_git_repo).catch(() => undefined);
			await deleteGitRepo(row.fork_git_repo).catch(() => undefined);
		}
		await env.DB.batch([
			env.DB.prepare("UPDATE repos SET state = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.fork_repo_id),
			env.DB.prepare("UPDATE agent_sessions SET status = 'discarded', ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").bind(row.id),
		]);
		await leavePlane(row.repo_id, row.id).catch(() => undefined);
		logEvent("agent_session.discarded", { session: row.id });
		return c.json({ ok: true });
	});
