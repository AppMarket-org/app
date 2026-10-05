import type { Repo } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import type { Context } from "hono";
import { listBranches, mintGitToken } from "../artifacts/git.ts";
import { auth } from "../auth/auth.ts";
import type { AppSession } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { entitled } from "../payments/routes.ts";
import { canEdit, canView } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { OwnerStore } from "../owners/store.ts";
import { processPush } from "../contributions/scan.ts";
import { updatedRefs, withMessages } from "./sideband.ts";
import { credentialOf, FORWARD_REQUEST_HEADERS, FORWARD_RESPONSE_HEADERS, type GitRoute, isArtifactsToken, parseGitPath } from "./access.ts";

const TOKEN_TTL = 900;

/** Short-lived Artifacts tokens per (repo, scope), reused within an isolate while they have time left. */
const minted = new Map<string, { token: string; expires: number }>();

async function artifactsToken(gitRepo: string, scope: "read" | "write"): Promise<string> {
	const key = `${gitRepo}:${scope}`;
	const hit = minted.get(key);
	if (hit && hit.expires - Date.now() > 120_000) return hit.token;
	const t = await mintGitToken(gitRepo, scope, TOKEN_TTL);
	minted.set(key, { token: t.token, expires: Date.parse(t.expiresAt) });
	if (minted.size > 500) minted.delete(minted.keys().next().value!);
	return t.token;
}

const challenge = (message: string) =>
	new Response(`${message}\n`, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="appmarket.org"', "Content-Type": "text/plain; charset=utf-8" } });
const refuse = (status: 403 | 404, message: string) => new Response(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** An appmarket.org sign-in (CLI device token) used as the Git password. */
async function sessionFor(token: string): Promise<AppSession | null> {
	const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }).catch(() => null);
	if (!session) return null;
	const scopes = (session.session as { scopes?: string | null }).scopes;
	return { ...session, orgIds: await new OwnerStore(env.DB).orgIdsOf(session.user.id), deviceScopes: scopes == null ? null : scopes.split(" ").filter(Boolean) };
}

/**
 * Git over HTTPS at appmarket.org/<owner>/<repo>.git, proxied to the repo's Artifacts remote.
 * Reading: anyone for published free repos, buyers for paid ones, owners and members always.
 * Pushing: owners and members. Credentials are an appmarket.org CLI sign-in (repos:read to read,
 * git:write to push) or an Artifacts token from the dashboard or an agent session, which is passed
 * through for Artifacts to check. The caller never sees the Artifacts host or its tokens.
 */
export async function gitProxy(c: Context): Promise<Response> {
	const url = new URL(c.req.url);
	const route = parseGitPath(url.pathname, url.searchParams, c.req.method);
	if (!route) return refuse(404, "Not found.");
	const repo = await new RepoStore(env.DB).findByPath(route.owner, route.slug);
	const write = route.service === "git-receive-pack";
	const credential = credentialOf(c.req.header("authorization"));
	if (!repo?.gitRepo || repo.state === "removed") return credential ? refuse(404, "Repository not found.") : challenge("Repository not found, or sign in to see it.");

	let upstreamToken: string;
	if (credential && isArtifactsToken(credential)) {
		upstreamToken = credential;
	} else {
		const session = credential ? await sessionFor(credential) : null;
		if (credential && !session) return challenge("That credential is not valid (expired or revoked). Run `appmarket login`.");
		const decision = await allowed(repo, session, write);
		if (decision !== "ok") {
			if (!session) return challenge(decision);
			return refuse(decision.startsWith("Not found") ? 404 : 403, decision);
		}
		upstreamToken = await artifactsToken(repo.gitRepo, write ? "write" : "read");
	}
	return forward(c, repo.gitRepo, route, upstreamToken, repo);
}

async function allowed(repo: Repo, session: AppSession | null, write: boolean): Promise<"ok" | string> {
	if (session?.deviceScopes) {
		const need = write ? "git:write" : "repos:read";
		if (!session.deviceScopes.includes(need)) return `This sign-in cannot ${write ? "push" : "read"} (needs ${need}). Run \`appmarket login\` again.`;
	}
	if (!canView(repo, session)) return "Not found, or sign in to see it.";
	if (write) return canEdit(repo, session) ? "ok" : `Only the owners of ${repo.fullName} can push to it. Fork it, push to your fork, and open a pull request.`;
	if (canEdit(repo, session)) return "ok";
	return (await entitled(repo, session)) ? "ok" : `${repo.fullName} is a paid app: buy it to clone it.`;
}

/**
 * "remote:" lines after a push: a link to open a pull request for each pushed branch (into the
 * repo it was forked from, for forks), or to the one already open.
 */
async function pullLinks(repo: Repo, branches: string[]): Promise<string[]> {
	const links = await env.DB.prepare("SELECT forked_from, session_of FROM repos WHERE id = ?").bind(repo.id).first<{ forked_from: string | null; session_of: string | null }>();
	const upstreamId = links?.session_of ?? links?.forked_from ?? null;
	const target = upstreamId ? await new RepoStore(env.DB).findById(upstreamId) : repo;
	if (!target || target.state === "removed") return [];
	const { defaultBranch } = upstreamId ? { defaultBranch: "" } : await listBranches(repo.gitRepo!);
	const lines: string[] = [];
	for (const branch of branches.slice(0, 3)) {
		if (!upstreamId && branch === defaultBranch) continue;
		const open = await env.DB.prepare("SELECT number FROM pull_requests WHERE source_repo_id = ? AND source_branch = ? AND state = 'open' ORDER BY number DESC LIMIT 1")
			.bind(repo.id, branch)
			.first<{ number: number }>();
		const base = `${env.PUBLIC_ORIGIN}/${target.fullName}/pulls`;
		if (lines.length) lines.push("");
		if (open) lines.push(`View pull request #${open.number} for '${branch}':`, `  ${base}/${open.number}`);
		else lines.push(`Create a pull request for '${branch}'${upstreamId ? ` on ${target.fullName}` : ""}:`, `  ${base}/new?source=${encodeURIComponent(repo.fullName)}&branch=${encodeURIComponent(branch)}`);
	}
	return lines.length ? ["", ...lines, ""] : [];
}

async function forward(c: Context, gitRepo: string, route: GitRoute, token: string, repo?: Repo): Promise<Response> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const remote = (await git.info()).remote;
	const target = route.kind === "info/refs" ? `${remote}/info/refs?service=${route.service}` : `${remote}/${route.service}`;
	const headers = new Headers({ Authorization: `Bearer ${token}` });
	for (const h of FORWARD_REQUEST_HEADERS) {
		const v = c.req.header(h);
		if (v) headers.set(h, v);
	}
	const upstream = await fetch(target, { method: c.req.method, headers, body: c.req.method === "POST" ? c.req.raw.body : undefined, ...(c.req.method === "POST" ? { duplex: "half" } : {}) } as RequestInit);
	if (upstream.status === 401 || upstream.status === 403) {
		logEvent("git.proxy_denied", { status: upstream.status, service: route.service });
		return challenge("That token is not valid for this repository.");
	}
	const out = new Headers();
	for (const h of FORWARD_RESPONSE_HEADERS) {
		const v = upstream.headers.get(h);
		if (v) out.set(h, v);
	}
	if (route.service === "git-receive-pack" && route.kind === "service" && upstream.ok && repo) {
		// #260: the push response is small (the report-status); read it to add pull request links.
		const body = new Uint8Array(await upstream.arrayBuffer());
		const branches = updatedRefs(body)
			.filter((r) => r.startsWith("refs/heads/"))
			.map((r) => r.slice("refs/heads/".length));
		logEvent("git.pushed", { repo: repo.fullName, branches: branches.length });
		// Checks, conformance, runtime and contributions right away (the minute scan is the fallback).
		c.executionCtx.waitUntil(processPush(repo.id).catch((e: unknown) => logEvent("git.push_processing_failed", { repo: repo.fullName, error: String(e) }, "warn")));
		const lines = branches.length ? await pullLinks(repo, branches).catch(() => []) : [];
		return new Response(withMessages(body, lines), { status: upstream.status, headers: out });
	}
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
