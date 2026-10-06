import { ApiError, call as apiCall } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { storedSessions } from "./session.ts";

/**
 * #260: pull requests from a checkout, for `appmarket pr` and the MCP tools. Works out where the
 * branch goes: an agent session's fork proposes to its repo, a template fork to the repo it was
 * forked from, anything else to its own repo's default branch.
 */
export interface PullView {
	number: number;
	title: string;
	body: string;
	state: "open" | "closed" | "merged";
	author: string;
	source: { repo: string; branch: string; fork: boolean };
	target: { repo: string; branch: string };
	headSha: string | null;
	mergedSha: string | null;
	/** Older servers do not send it. */
	checks?: { status: string; sha: string; failed: string[] } | null;
	merge: { status: string; sha: string | null; error: string | null; conflicts?: string[] } | null;
	review: { decision: "approved" | "changes_requested" | null; approvals: number };
	mergeBlocked: string | null;
	canMerge: boolean;
}

export interface Deps {
	call: typeof apiCall;
	token: (api: string) => Promise<string | null>;
}
const defaults: Deps = { call: apiCall, token: async (api) => (await loadCredentials(api))?.token ?? null };

export interface PullContext {
	api: string;
	token: string;
	/** Where the branch lives (owner/repo). */
	source: string;
	/** Where it is proposed (owner/repo). */
	target: string;
	branch: string | null;
	call: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
}

export class PullError extends Error {}

export async function pullContext(cwd = process.cwd(), deps: Deps = defaults): Promise<PullContext> {
	const root = repoRoot(cwd);
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) throw new PullError("This folder is not an appmarket.org repo (run `appmarket init`).");
	const sessionId = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root });
	const session = sessionId ? storedSessions().find((s) => s.id === sessionId) : undefined;
	const api = session?.api ?? gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	const token = await deps.token(api);
	if (!token) throw new PullError("Not signed in to appmarket.org: run `appmarket login`.");
	const call = <T>(path: string, init: { method?: string; body?: unknown } = {}) => deps.call<T>(api, path, { ...init, token, timeoutMs: 60_000 });
	const branch = gitOr(["symbolic-ref", "--quiet", "--short", "HEAD"], "", { cwd: root }) || null;
	if (session) return { api, token, source: session.fork, target: repo, branch, call };
	const info = await call<{ fullName: string; forkedFrom: { fullName: string } | null }>(`/api/repos/${repo}`);
	return { api, token, source: info.fullName, target: info.forkedFrom?.fullName ?? info.fullName, branch, call };
}

/** The API's error message, or a sentence for the common statuses. */
export function explainError(error: unknown): string {
	if (error instanceof PullError) return error.message;
	if (error instanceof ApiError) {
		const body = (error.body ?? {}) as { message?: string; error?: string };
		if (error.status === 401) return "Not signed in to appmarket.org: run `appmarket login`.";
		if (error.status === 403 && body.error === "insufficient_scope") return "This sign-in cannot change pull requests: run `appmarket login` again.";
		if (error.status === 404) return "Not found, or you cannot see it.";
		return body.message ?? body.error ?? `HTTP ${error.status}`;
	}
	return `appmarket.org could not be reached (${error instanceof Error ? error.message : String(error)}).`;
}

export async function openPull(ctx: PullContext, input: { title: string; body?: string; base?: string }): Promise<PullView> {
	if (!ctx.branch) throw new PullError("Check out the branch you want to propose first.");
	try {
		return await ctx.call<PullView>(`/api/repos/${ctx.target}/pulls`, {
			method: "POST",
			body: { title: input.title, body: input.body ?? "", source: ctx.source, sourceBranch: ctx.branch, ...(input.base ? { targetBranch: input.base } : {}) },
		});
	} catch (error) {
		// Already open for this branch: return that one.
		const number = error instanceof ApiError && error.status === 409 ? (error.body as { number?: number } | null)?.number : undefined;
		if (number) return getPull(ctx, number);
		if (error instanceof ApiError && error.status === 400 && /does not exist/.test(String((error.body as { message?: string })?.message))) {
			throw new PullError(`${ctx.branch} is not on appmarket.org yet: push it first (git push -u <remote> ${ctx.branch}).`);
		}
		throw error;
	}
}

export const getPull = (ctx: PullContext, n: number) => ctx.call<PullView>(`/api/repos/${ctx.target}/pulls/${n}`);

export async function listPulls(ctx: PullContext, state: "open" | "closed" | "merged" | "all" = "open"): Promise<PullView[]> {
	return (await ctx.call<{ items: PullView[] }>(`/api/repos/${ctx.target}/pulls?state=${state}`)).items;
}

/** The pull request for a number, or the open one for the current branch. */
export async function resolvePull(ctx: PullContext, n?: number): Promise<PullView> {
	if (n) return getPull(ctx, n);
	const mine = (await listPulls(ctx)).find((p) => p.source.repo === ctx.source && p.source.branch === ctx.branch);
	if (!mine) throw new PullError(`No open pull request for ${ctx.branch ?? "this checkout"}. Open one with \`appmarket pr create\`.`);
	return mine;
}

export const mergePull = (ctx: PullContext, n: number) => ctx.call<PullView>(`/api/repos/${ctx.target}/pulls/${n}/merge`, { method: "POST", body: {} });

export interface Conversation {
	comments: { id: string; author: string; body: string; path: string | null; line: number | null; side: string | null; createdAt: string }[];
	reviews: { reviewer: string; state: string; body: string; createdAt: string }[];
}
export const conversation = (ctx: PullContext, n: number) => ctx.call<Conversation>(`/api/repos/${ctx.target}/pulls/${n}/comments`);

export const reply = (ctx: PullContext, n: number, input: { body: string; path?: string; line?: number; side?: "old" | "new" }) =>
	ctx.call<{ id: string }>(`/api/repos/${ctx.target}/pulls/${n}/comments`, { method: "POST", body: input });

/** One line per state, for people and agents. */
export function describe(p: PullView, origin: string): string {
	const lines = [`#${p.number} ${p.title}  [${p.state}]`, `${p.source.fork ? `${p.source.repo}:` : ""}${p.source.branch} → ${p.target.repo}:${p.target.branch}`, `${origin}/${p.target.repo}/pulls/${p.number}`];
	if (p.review.decision) lines.push(p.review.decision === "approved" ? `Approved (${p.review.approvals})` : "Changes requested");
	// Older servers do not send checks.
	if (p.state === "open" && p.checks) lines.push(`Checks: ${p.checks.status}${p.checks.failed.length ? ` (${p.checks.failed.join(", ")})` : ""} on ${p.checks.sha.slice(0, 12)}`);
	if (p.merge) lines.push(`Merge: ${p.merge.status}${p.merge.sha ? ` ${p.merge.sha.slice(0, 12)}` : ""}${p.merge.error ? ` (${p.merge.error})` : ""}`);
	if (p.state === "open") lines.push(p.mergeBlocked ? `Cannot merge yet: ${p.mergeBlocked}` : p.canMerge ? "Ready to merge." : "Waiting for the repo's owners to merge.");
	return lines.join("\n");
}

/** Conversation as text, oldest first. */
export function describeConversation(c: Conversation): string {
	const items = [
		...c.comments.map((x) => ({ at: x.createdAt, text: `${x.author}${x.path ? ` on ${x.path}:${x.line} (${x.side})` : ""}: ${x.body}` })),
		...c.reviews.map((r) => ({ at: r.createdAt, text: `${r.reviewer} ${r.state === "approved" ? "approved" : r.state === "changes_requested" ? "requested changes" : "reviewed"}${r.body ? `: ${r.body}` : ""}` })),
	].sort((a, b) => a.at.localeCompare(b.at));
	return items.length ? items.map((i) => i.text).join("\n\n") : "No comments yet.";
}
