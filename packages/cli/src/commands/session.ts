import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, call } from "../api.ts";
import { apiBase, HOME } from "../config.ts";
import { tokenForRemote } from "./setup-git.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { resolveRepo } from "./init.ts";

/**
 * #29 (R9): agent sessions. `session start` forks the repo on appmarket.org for this session and
 * adds the fork as the `appmarket-session` remote. Git asks `appmarket git-credential` for the
 * session's short-lived write token, so it never lands in Git config, remote URLs or logs.
 */
const DIR = join(HOME, "agent-sessions");
export const SESSION_REMOTE = "appmarket-session";
const HARNESSES = ["claude-code", "codex", "cursor", "opencode", "other"];

export interface StoredSession {
	id: string;
	api: string;
	repo: string;
	fork: string;
	remote: string;
	token: string;
	expiresAt: string;
}

interface SessionToken {
	session: { id: string; repo: string; fork: string; inRepo?: boolean };
	remote: string;
	token: string;
	expiresAt: string;
}

const file = (id: string) => join(DIR, `${id.replace(/[^0-9a-f-]/g, "")}.json`);

function save(s: StoredSession): void {
	mkdirSync(DIR, { recursive: true, mode: 0o700 });
	writeFileSync(file(s.id), JSON.stringify(s), { mode: 0o600 });
	chmodSync(file(s.id), 0o600);
}

export function storedSessions(): StoredSession[] {
	if (!existsSync(DIR)) return [];
	return readdirSync(DIR)
		.filter((f) => f.endsWith(".json"))
		.flatMap((f) => {
			try {
				return [JSON.parse(readFileSync(join(DIR, f), "utf8")) as StoredSession];
			} catch {
				return [];
			}
		});
}

/** The remote URL Git asks credentials for, from `git credential` input (with useHttpPath). */
export function credentialUrl(input: string): string | null {
	const fields = Object.fromEntries(
		input
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.includes("="))
			.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
	);
	if (!fields.protocol || !fields.host) return null;
	// #309: a session's remote names the session as the user (agent-<id>@host), so it gets the session's sign-in.
	const user = fields.username ? `${fields.username}@` : "";
	return `${fields.protocol}://${user}${fields.host}/${(fields.path ?? "").replace(/^\/+/, "")}`;
}

const normal = (url: string) => url.replace(/\/+$/, "").replace(/\.git$/, "");

export function sessionFor(url: string, sessions: StoredSession[]): StoredSession | null {
	return sessions.find((s) => normal(s.remote) === normal(url)) ?? null;
}

async function signedIn(api: string) {
	const creds = await loadCredentials(api);
	if (!creds) throw new Error("Not signed in. Run `appmarket login`.");
	return creds;
}

function explain(error: unknown): string {
	if (error instanceof ApiError) {
		const body = error.body as { message?: string; error?: string } | null;
		if (error.status === 403) return "This device may not start agent sessions. Run `appmarket login` again to grant the sessions scope.";
		return body?.message ?? body?.error ?? `HTTP ${error.status}`;
	}
	// Network errors say only "fetch failed"; the cause says what actually went wrong.
	const cause = error instanceof Error ? (error.cause as { code?: string; message?: string } | undefined) : undefined;
	const base = error instanceof Error ? error.message : String(error);
	return cause ? `${base} (${cause.code ?? cause.message})` : base;
}

export async function sessionStart(api: string, explicit: string | undefined, harness: string | undefined): Promise<number> {
	const root = repoRoot();
	if (!root) return (console.error("Run this inside a Git checkout of an appmarket.org repo."), 1);
	try {
		const creds = await signedIn(api);
		const { repo } = await resolveRepo(api, creds.token, root, explicit);
		const started = await call<SessionToken>(api, `/api/repos/${repo}/sessions`, { method: "POST", token: creds.token, body: { harness: HARNESSES.includes(harness ?? "") ? harness : "other" } });
		save({ id: started.session.id, api, repo, fork: started.session.fork, remote: started.remote, token: started.token, expiresAt: started.expiresAt });
		const git = (args: string[]) => gitOr(args, "", { cwd: root });
		git(["remote", "remove", SESSION_REMOTE]);
		git(["remote", "add", SESSION_REMOTE, started.remote]);
		// Only the helper command is stored in Git config; the token stays in ~/.appmarket (0600). The
		// empty helper first clears inherited ones (e.g. osxkeychain), which would otherwise store
		// the session token after a push and keep it beyond the session.
		git(["config", "--unset-all", `credential.${started.remote}.helper`]);
		git(["config", "--add", `credential.${started.remote}.helper`, ""]);
		git(["config", "--add", `credential.${started.remote}.helper`, "!appmarket git-credential"]);
		git(["config", `credential.${started.remote}.useHttpPath`, "true"]);
		git(["config", "appmarket.session", started.session.id]);
		console.log(
			started.session.inRepo
				? `Agent session ${started.session.id} started in ${repo}.
The agent works on its own branches and pushes them to the ${SESSION_REMOTE} remote:
  git push ${SESSION_REMOTE} HEAD:refs/heads/<branch>
Any branch except protected ones (the default branch, and those in Settings > Pull requests); no tags.
Open a pull request for the branch (appmarket pr create, or the pr_open MCP tool); merging stays with you.
The session's sign-in works until ${started.expiresAt} and renews itself while the session is active.
Tasks on the repo's Agents board (issues assigned to Agents) can be claimed with the MCP tools of
\`appmarket mcp\` (plane_board, plane_claim, plane_lease, plane_finish). Run \`appmarket session end\` when done.`
				: `Agent session ${started.session.id} started in the fork ${started.session.fork}.
Push the agent's work there; your repo ${repo} stays untouched:
  git push ${SESSION_REMOTE} HEAD:refs/heads/<branch>
The write token works until ${started.expiresAt} and renews itself while the session is active.
When you are happy with the work, merge it into ${repo} yourself; then run \`appmarket session end\`.`,
		);
		return 0;
	} catch (error) {
		console.error(`Could not start a session: ${explain(error)}`);
		return 1;
	}
}

/**
 * `git credential` helper: agent session remotes get the session's token (renewed when it is about
 * to expire); other appmarket.org remotes get this machine's sign-in (`appmarket setup-git`).
 */
export async function gitCredential(action: string | undefined, input: string, api = apiBase()): Promise<number> {
	if (action !== "get") return 0;
	const url = credentialUrl(input);
	const stored = url ? sessionFor(url, storedSessions()) : null;
	if (!stored) {
		const token = url ? await tokenForRemote(url, api).catch(() => null) : null;
		if (token) process.stdout.write(`username=appmarket\npassword=${token}\n`);
		return 0;
	}
	let session = stored;
	if (Date.parse(stored.expiresAt) - Date.now() < 5 * 60_000) {
		try {
			const creds = await signedIn(stored.api);
			const renewed = await call<SessionToken>(stored.api, `/api/sessions/${stored.id}/token`, { method: "POST", token: creds.token, body: {} });
			session = { ...stored, token: renewed.token, expiresAt: renewed.expiresAt };
			save(session);
		} catch {
			return 0;
		}
	}
	process.stdout.write(`username=${session.remote.match(/^https?:\/\/([^@/]+)@/)?.[1] ?? "appmarket"}\npassword=${session.token}\n`);
	return 0;
}

function current(root: string | null, id: string | undefined): StoredSession | null {
	const wanted = id ?? (root ? gitOr(["config", "appmarket.session"], "", { cwd: root }).trim() : "");
	return storedSessions().find((s) => s.id === wanted) ?? null;
}

function forget(root: string | null, s: StoredSession): void {
	if (root && gitOr(["config", "appmarket.session"], "", { cwd: root }).trim() === s.id) {
		gitOr(["remote", "remove", SESSION_REMOTE], "", { cwd: root });
		gitOr(["config", "--remove-section", `credential.${s.remote}`], "", { cwd: root });
		gitOr(["config", "--unset", "appmarket.session"], "", { cwd: root });
	}
	rmSync(file(s.id), { force: true });
}

export async function sessionEnd(api: string, id: string | undefined, discard: boolean): Promise<number> {
	const root = repoRoot();
	const s = current(root, id);
	if (!s) return (console.error("No agent session here. Pass its id: `appmarket session end <id>`."), 1);
	try {
		const creds = await signedIn(s.api ?? api);
		await call(s.api, discard ? `/api/sessions/${s.id}` : `/api/sessions/${s.id}/end`, { method: discard ? "DELETE" : "POST", token: creds.token, body: discard ? undefined : {} });
	} catch (error) {
		console.error(`Could not ${discard ? "discard" : "end"} the session: ${explain(error)}`);
		return 1;
	}
	forget(root, s);
	const inRepo = s.fork === s.repo;
	console.log(
		discard
			? inRepo
				? `Session ${s.id} discarded; its sign-in is revoked and the branches it created are deleted.`
				: `Session ${s.id} discarded; its fork ${s.fork} is deleted.`
			: inRepo
				? `Session ${s.id} ended; its sign-in is revoked. Its branches stay in ${s.repo} for review.`
				: `Session ${s.id} ended; its token is revoked. The fork ${s.fork} stays for review.`,
	);
	return 0;
}

export async function sessionList(api: string, explicit: string | undefined): Promise<number> {
	const root = repoRoot();
	if (!root) return (console.error("Run this inside a Git checkout of an appmarket.org repo."), 1);
	try {
		const creds = await signedIn(api);
		const { repo } = await resolveRepo(api, creds.token, root, explicit);
		const { items } = await call<{ items: { id: string; fork: string; harness: string; status: string; startedBy: string; createdAt: string }[] }>(api, `/api/repos/${repo}/sessions`, { token: creds.token });
		if (!items.length) console.log(`No agent sessions for ${repo}.`);
		for (const s of items) console.log(`${s.id}  ${s.status.padEnd(9)} ${s.harness.padEnd(11)} ${s.fork}  ${s.startedBy}  ${s.createdAt.slice(0, 16).replace("T", " ")}`);
		return 0;
	} catch (error) {
		console.error(`Could not list sessions: ${explain(error)}`);
		return 1;
	}
}
