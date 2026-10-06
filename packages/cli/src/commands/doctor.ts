import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Checkpoint, CheckpointPage } from "@appmarket/shared";
import { transcriptEvents } from "../adapters/claude-code.ts";
import { codexTranscriptEvents } from "../adapters/codex.ts";
import { call } from "../api.ts";
import { HOME, VERSION } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { git, gitOr, repoRoot } from "../git.ts";
import { queued } from "../queue.ts";
import { readState, writeState } from "../state.ts";
import { settingsPath, type HookHarness } from "./adapter.ts";

type Level = "ok" | "warn" | "fail";
interface Check {
	level: Level;
	name: string;
	detail: string;
}

const MARK = "# appmarket checkpoint hook";
const STALE_DAYS = 30;

function versionOf(bin: string, args = ["--version"]): string | null {
	try {
		return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim().split("\n")[0]!;
	} catch {
		return null;
	}
}

/** The newest file under `dir` matching `pattern` (shallow walk, a few levels). */
function newest(dir: string, pattern: RegExp, depth = 4): string | null {
	let best: { path: string; mtime: number } | null = null;
	const walk = (d: string, level: number) => {
		let entries: string[] = [];
		try {
			entries = readdirSync(d);
		} catch {
			return;
		}
		for (const name of entries) {
			const path = join(d, name);
			let stat;
			try {
				stat = statSync(path);
			} catch {
				continue;
			}
			if (stat.isDirectory() && level > 0) walk(path, level - 1);
			else if (stat.isFile() && pattern.test(name) && (!best || stat.mtimeMs > best.mtime)) best = { path, mtime: stat.mtimeMs };
		}
	};
	walk(dir, depth);
	return (best as { path: string } | null)?.path ?? null;
}

function adapterInstalled(harness: HookHarness): boolean {
	try {
		return readFileSync(settingsPath(harness), "utf8").includes(`appmarket hook ${harness}`);
	} catch {
		return false;
	}
}

/** Runs the adapter's transcript parser on the newest real transcript: a format change shows up as nothing found. */
export function adapterHealth(harness: HookHarness): Check {
	const name = harness === "codex" ? "Codex adapter" : "Claude Code adapter";
	const bin = harness === "codex" ? "codex" : "claude";
	const version = versionOf(bin);
	const installed = adapterInstalled(harness) || (harness === "claude-code" && pluginInstalled());
	if (!version && !installed) return { level: "ok", name, detail: `${bin} not found; nothing to check` };
	if (!installed) return { level: "warn", name, detail: `${version ?? bin} found but the adapter is not installed: appmarket adapter install ${harness}` };
	const dir = harness === "codex" ? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions") : join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
	const latest = newest(dir, harness === "codex" ? /^rollout-.*\.jsonl$/ : /\.jsonl$/);
	if (!latest) return { level: "warn", name, detail: `installed; no session transcripts in ${dir} yet` };
	const until = new Date(Date.now() + 60_000).toISOString();
	const events = harness === "codex" ? codexTranscriptEvents(latest, 0, until) : transcriptEvents(latest, Math.max(0, statSync(latest).size - 2 * 1024 * 1024), until);
	const settings = events.find((e) => e.type === "settings");
	const usage = events.some((e) => e.type === "usage");
	if (!settings?.model || !usage)
		return { level: "fail", name, detail: `${version ?? bin}: could not read model/usage from its newest transcript; the format may have changed in this version. Commits still get checkpoints, without those fields.` };
	return { level: "ok", name, detail: `${version ?? bin}; newest transcript readable (model ${settings.model})` };
}

function pluginInstalled(): boolean {
	try {
		return readFileSync(join(homedir(), ".claude", "plugins", "installed_plugins.json"), "utf8").includes("appmarket@");
	} catch {
		return false;
	}
}

function hookCheck(root: string): Check {
	const hooksDir = resolve(root, git(["rev-parse", "--git-path", "hooks"], { cwd: root }));
	const has = (n: string) => {
		try {
			return readFileSync(join(hooksDir, n), "utf8").includes(MARK);
		} catch {
			return false;
		}
	};
	const missing = ["post-commit", "post-rewrite"].filter((n) => !has(n));
	return missing.length ? { level: "fail", name: "Git hooks", detail: `missing ${missing.join(", ")}: run appmarket init` } : { level: "ok", name: "Git hooks", detail: "post-commit and post-rewrite installed" };
}

/** C11 (#122): everything that can stop checkpoints from being recorded or uploaded. */
export async function doctor(api: string): Promise<number> {
	const checks: Check[] = [];
	const root = repoRoot();
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	const repoApi = root ? gitOr(["config", "--get", "appmarket.api"], api, { cwd: root }) : api;
	if (!root) checks.push({ level: "warn", name: "Repo", detail: "not inside a Git repository; repo checks skipped" });
	else if (!repo) checks.push({ level: "warn", name: "Repo", detail: "this repo is not set up: appmarket init" });
	else {
		checks.push({ level: gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true" ? "warn" : "ok", name: "Repo", detail: `${repo}${gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true" ? " (disabled: appmarket enable)" : ""}` });
		checks.push(hookCheck(root));
	}
	const creds = await loadCredentials(repoApi);
	try {
		await call(repoApi, "/api/health", { timeoutMs: 8000 });
		checks.push({ level: "ok", name: "Connection", detail: repoApi });
	} catch (error) {
		checks.push({ level: "warn", name: "Connection", detail: `${repoApi} unreachable (${error instanceof Error ? error.message : String(error)}); checkpoints queue until it is back` });
	}
	if (!creds) checks.push({ level: "fail", name: "Sign-in", detail: "not signed in: appmarket login" });
	else {
		const session = await call<{ session: { expiresAt: string } } | null>(repoApi, "/api/auth/get-session", { token: creds.token }).catch(() => undefined);
		if (session === null) checks.push({ level: "fail", name: "Sign-in", detail: "token revoked or expired: appmarket login" });
		else if (session) checks.push({ level: "ok", name: "Sign-in", detail: `${creds.handle} on ${creds.device}, expires ${session.session.expiresAt.slice(0, 10)}` });
		else checks.push({ level: "warn", name: "Sign-in", detail: `${creds.handle} (could not verify while offline)` });
	}
	checks.push(adapterHealth("claude-code"), adapterHealth("codex"));
	const sessions = join(HOME, "sessions");
	checks.push(existsSync(sessions) ? { level: "ok", name: "Local state", detail: HOME } : { level: "warn", name: "Local state", detail: `${HOME} has no session buffers yet` });

	const icon = { ok: "✓", warn: "!", fail: "✗" };
	for (const c of checks) console.log(`${icon[c.level]} ${c.name.padEnd(20)} ${c.detail}`);
	return checks.some((c) => c.level === "fail") ? 1 : 0;
}

/** C9 (#122): queue, last upload, and this repo's checkpoints still waiting for a push. */
export async function status(api: string): Promise<number> {
	const items = queued();
	const state = readState();
	// In a repo set up with `init --api`, its checkpoints go to that server, not the default.
	const here = repoRoot();
	const server = here ? gitOr(["config", "--get", "appmarket.api"], api, { cwd: here }) : api;
	console.log(`Server:            ${server}`);
	console.log(`Queued uploads:    ${items.length}${items.length ? ` (oldest ${items.map((i) => i.firstAt).sort()[0]!.slice(0, 16).replace("T", " ")})` : ""}`);
	console.log(`Last upload:       ${state.lastUploadAt ? state.lastUploadAt.slice(0, 16).replace("T", " ") : "never"}`);
	console.log(`Adapters:          ${(["claude-code", "codex"] as const).filter(adapterInstalled).join(", ") || "none (appmarket adapter install <harness>)"}`);
	const root = repoRoot();
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) {
		console.log("Repo:              not set up here");
		return 0;
	}
	const repoApi = gitOr(["config", "--get", "appmarket.api"], api, { cwd: root });
	const disabled = gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true";
	console.log(`Repo:              ${repo}${disabled ? " (disabled)" : ""}`);
	const creds = await loadCredentials(repoApi);
	if (!creds) {
		console.log("Pending:           sign in to see checkpoints waiting for a push");
		return 0;
	}
	try {
		const pending: Checkpoint[] = [];
		let before: string | undefined;
		for (let page = 0; page < 5; page++) {
			const res = await call<CheckpointPage>(repoApi, `/api/repos/${repo}/checkpoints?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`, { token: creds.token });
			pending.push(...res.items.filter((c) => c.state === "pending"));
			if (!res.next) break;
			before = res.next;
		}
		const stale = pending.filter((c) => Date.now() - Date.parse(c.received_at) > STALE_DAYS * 86_400_000);
		console.log(`Pending:           ${pending.length} checkpoint${pending.length === 1 ? "" : "s"} for commits not pushed to appmarket.org yet`);
		if (stale.length) console.log(`                   ! ${stale.length} older than ${STALE_DAYS} days (${stale.slice(0, 3).map((c) => c.commit.slice(0, 7)).join(", ")}${stale.length > 3 ? ", …" : ""}): push them, or delete the checkpoints in the dashboard`);
	} catch {
		console.log("Pending:           could not reach appmarket.org");
	}
	return 0;
}

/** C15: at most once a day, a one-line notice when a newer CLI is on npm. Never updates itself. */
export async function updateNotice(): Promise<void> {
	if (process.env.APPMARKET_NO_UPDATE_CHECK || !process.stderr.isTTY) return;
	const state = readState();
	let latest = state.latestVersion;
	if (!state.updateCheckedAt || Date.now() - Date.parse(state.updateCheckedAt) > 86_400_000) {
		writeState({ updateCheckedAt: new Date().toISOString() });
		try {
			const res = await fetch("https://registry.npmjs.org/appmarket/latest", { signal: AbortSignal.timeout(2000) });
			if (res.ok) latest = ((await res.json()) as { version?: string }).version;
			writeState({ latestVersion: latest });
		} catch {
			return;
		}
	}
	if (latest && newer(latest, VERSION)) console.error(`appmarket ${latest} is available (you have ${VERSION}): npm i -g appmarket`);
}

export function newer(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
}

