import { AGENT_HARNESSES, type AgentSession, type AgentSessionToken, MAX_ACTIVE_SESSIONS, SESSION_TOKEN_TTL } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { deleteGitRepo, listBranches, mintGitToken, revokeAllGitTokens, updateRef } from "../artifacts/git.ts";
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
	inRepo: r.fork_repo_id === r.repo_id,
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

/** The session's remote: the repo's own URL, with the session in the user name so Git asks for its sign-in. */
const sessionRemote = (row: SessionRow) => publicRemote(row.fork).replace("://", `://agent-${row.id}@`);

async function issueToken(row: SessionRow, gitRepo: string): Promise<AgentSessionToken> {
	if (row.fork_repo_id === row.repo_id) return issueSignIn(row);
	// Sessions started before #309 keep their fork and its Artifacts write token until they end.
	const minted = await mintGitToken(gitRepo, "write", SESSION_TOKEN_TTL);
	await env.DB.prepare("UPDATE agent_sessions SET token_expires_at = ? WHERE id = ?").bind(minted.expiresAt, row.id).run();
	return { session: toSession({ ...row, token_expires_at: minted.expiresAt }), remote: publicRemote(row.fork), token: minted.token, expiresAt: minted.expiresAt };
}

/**
 * #309: the session's own appmarket.org sign-in (git only, this repo, 8 hours), never an Artifacts
 * token, so every push goes through the Git endpoint and its branch rules (#308). A renewal
 * replaces it.
 */
async function issueSignIn(row: SessionRow): Promise<AgentSessionToken> {
	const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TOKEN_TTL * 1000).toISOString();
	const authId = crypto.randomUUID();
	await env.DB.batch([
		env.DB.prepare('DELETE FROM "session" WHERE id = (SELECT auth_session_id FROM agent_sessions WHERE id = ?)').bind(row.id),
		env.DB.prepare(
			`INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId, userAgent, clientId, scopes, deviceName) VALUES (?, ?, ?, ?, ?, ?, 'appmarket agent session', 'appmarket-agent', 'repos:read git:write', ?)`,
		).bind(authId, expiresAt, token, now.toISOString(), now.toISOString(), row.user_id, `${row.harness} session ${row.id.slice(0, 8)}`),
		env.DB.prepare("UPDATE agent_sessions SET auth_session_id = ?, token_expires_at = ? WHERE id = ?").bind(authId, expiresAt, row.id),
	]);
	return { session: toSession({ ...row, token_expires_at: expiresAt }), remote: sessionRemote(row), token, expiresAt };
}

/** Ends a session's access: its sign-in (in-repo) or its fork's tokens (older sessions). */
async function revokeAccess(row: SessionRow): Promise<void> {
	await env.DB.prepare('DELETE FROM "session" WHERE id = (SELECT auth_session_id FROM agent_sessions WHERE id = ?)').bind(row.id).run();
	if (row.fork_repo_id !== row.repo_id && row.fork_git_repo) await revokeAllGitTokens(row.fork_git_repo).catch(() => undefined);
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

		// #309: the session works in the repo itself, on its own branches.
		const id = crypto.randomUUID();
		await env.DB.prepare("INSERT INTO agent_sessions (id, repo_id, fork_repo_id, user_id, harness, token_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(id, source.id, source.id, session.user.id, harness, new Date().toISOString())
			.run();
		const row = (await findSession(id))!;
		logEvent("agent_session.started", { session: id, repo: source.fullName, harness, user: session.user.id });
		c.header("Cache-Control", "no-store");
		return c.json(await issueSignIn(row), 201);
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
		if (row.status === "active") await revokeAccess(row);
		await env.DB.prepare("UPDATE agent_sessions SET status = 'ended', ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ? AND status = 'active'").bind(row.id).run();
		// #236: the agent leaves the collaboration board; tasks it claimed but did not finish reopen.
		await leavePlane(row.repo_id, row.id).catch(() => undefined);
		logEvent("agent_session.ended", { session: row.id });
		return c.json(toSession((await findSession(row.id))!));
	})
	.delete("/:id", async (c) => {
		const row = await manageable(c);
		if (!row) return c.json({ error: "not_found" }, 404);
		await revokeAccess(row);
		if (row.fork_repo_id === row.repo_id) {
			// #309: discarding deletes the branches the session created in the repo.
			await discardBranches(row);
			await env.DB.prepare("UPDATE agent_sessions SET status = 'discarded', ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").bind(row.id).run();
		} else {
			// Older sessions: discarding removes the fork and its Git repository.
			if (row.fork_git_repo) await deleteGitRepo(row.fork_git_repo).catch(() => undefined);
			await env.DB.batch([
				env.DB.prepare("UPDATE repos SET state = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(row.fork_repo_id),
				env.DB.prepare("UPDATE agent_sessions SET status = 'discarded', ended_at = COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?").bind(row.id),
			]);
		}
		await leavePlane(row.repo_id, row.id).catch(() => undefined);
		logEvent("agent_session.discarded", { session: row.id });
		return c.json({ ok: true });
	});

/** #309: deletes the branches a session created (never protected ones: it could not create those). */
async function discardBranches(row: SessionRow): Promise<void> {
	if (!row.fork_git_repo) return;
	const { results } = await env.DB.prepare("SELECT branch FROM agent_session_branches WHERE session_id = ?").bind(row.id).all<{ branch: string }>();
	if (!results.length) return;
	const heads = new Map((await listBranches(row.fork_git_repo)).branches.map((b) => [b.name, b.sha]));
	for (const { branch } of results) {
		const sha = heads.get(branch);
		if (sha) await updateRef(row.fork_git_repo, branch, sha, "0".repeat(40)).catch(() => "error");
	}
	await env.DB.prepare("DELETE FROM agent_session_branches WHERE session_id = ?").bind(row.id).run();
}
