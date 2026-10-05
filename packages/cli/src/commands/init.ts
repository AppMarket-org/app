import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { call } from "../api.ts";
import { loadCredentials } from "../credentials.ts";
import { git, gitOr, repoRoot } from "../git.ts";

const MARK = "# appmarket checkpoint hook";
/** C4: three lines that matter. Runs a chained hook, then the CLI if it is installed; always exits 0. */
const HOOK = `#!/bin/sh
${MARK} (installed by \`appmarket init\`; remove with \`appmarket disable\` or delete this file)
[ -x "$(dirname "$0")/post-commit.local" ] && "$(dirname "$0")/post-commit.local" "$@"
command -v appmarket >/dev/null 2>&1 && appmarket checkpoint --hook >/dev/null 2>&1
exit 0
`;

interface MineRepo {
	fullName: string;
	gitRepo: string | null;
}

/** A remote of this repo: appmarket.org/<owner>/<repo>.git, or (older checkouts) its Artifacts remote. */
export const pointsAt = (url: string, repo: { fullName: string; gitRepo: string | null }) =>
	url.replace(/\/+$/, "").endsWith(`/${repo.fullName}.git`) || (!!repo.gitRepo && url.includes(`/${repo.gitRepo}.git`));

/** Finds which appmarket repo this checkout is: an explicit owner/slug, or a remote that points at it. */
export async function resolveRepo(api: string, token: string, root: string, explicit?: string): Promise<{ repo: string; remote: string | null }> {
	const remotes = gitOr(["remote", "-v"], "", { cwd: root })
		.split("\n")
		.map((l) => l.split(/\s+/))
		.filter((p) => p.length >= 2)
		.map(([name, url]) => ({ name: name!, url: url! }));
	const { items } = await call<{ items: MineRepo[] }>(api, "/api/repos/mine", { token });
	if (explicit) {
		const match = items.find((r) => r.fullName === explicit);
		if (!match) throw new Error(`${explicit} is not one of your repos (or your organizations').`);
		const remote = remotes.find((r) => pointsAt(r.url, match));
		return { repo: match.fullName, remote: remote?.name ?? null };
	}
	for (const r of remotes) {
		const match = items.find((m) => pointsAt(r.url, m));
		if (match) return { repo: match.fullName, remote: r.name };
	}
	throw new Error("No remote of this checkout points at one of your appmarket.org repos. Run `appmarket init <owner>/<repo>`.");
}

/** #125: copies checkpoints to rewritten commits; stdin ("old new" pairs) goes to the chained hook and to the CLI. */
const REWRITE_HOOK = `#!/bin/sh
${MARK} (installed by \`appmarket init\`)
input=$(cat)
[ -x "$(dirname "$0")/post-rewrite.local" ] && printf '%s\\n' "$input" | "$(dirname "$0")/post-rewrite.local" "$@"
command -v appmarket >/dev/null 2>&1 && printf '%s\\n' "$input" | appmarket rewritten "$1" >/dev/null 2>&1
exit 0
`;

function writeHook(hooksDir: string, name: string, body: string): string {
	const hook = join(hooksDir, name);
	if (existsSync(hook) && !readFileSync(hook, "utf8").includes(MARK)) {
		// Keep the existing hook: ours runs it first as <name>.local.
		renameSync(hook, join(hooksDir, `${name}.local`));
	}
	writeFileSync(hook, body);
	chmodSync(hook, 0o755);
	return hook;
}

export function installHook(root: string): string {
	const hooksDir = resolve(root, git(["rev-parse", "--git-path", "hooks"], { cwd: root }));
	mkdirSync(hooksDir, { recursive: true });
	writeHook(hooksDir, "post-rewrite", REWRITE_HOOK);
	return writeHook(hooksDir, "post-commit", HOOK);
}

function addConfig(root: string, key: string, value: string): void {
	const existing = gitOr(["config", "--get-all", key], "", { cwd: root }).split("\n");
	if (!existing.includes(value)) git(["config", "--add", key, value], { cwd: root });
}

/** Harnesses on this machine (adapters ship separately: Claude Code first, #112). */
function detectHarnesses(): string[] {
	const found: string[] = [];
	const onPath = (bin: string) => (process.env.PATH ?? "").split(delimiter).some((dir) => existsSync(join(dir, bin)));
	if (onPath("claude") || existsSync(join(homedir(), ".claude"))) found.push("claude-code");
	if (onPath("codex") || existsSync(join(homedir(), ".codex"))) found.push("codex");
	if (onPath("opencode") || existsSync(join(homedir(), ".config", "opencode"))) found.push("opencode");
	if (onPath("cursor") || existsSync(join(homedir(), ".cursor"))) found.push("cursor");
	return found;
}

export const AGENTS_MARK = "<!-- appmarket:record_context -->";
const AGENTS_LINE = `${AGENTS_MARK}\nBefore each \`git commit\`, call the \`record_context\` tool (appmarket MCP server, \`appmarket mcp\`) with the user's request and one sentence on what changed.\n`;

/** #121: one instruction for agents without hooks, in AGENTS.md (or CLAUDE.md when only that exists). Idempotent. */
export function addAgentsLine(root: string): string | null {
	const agents = join(root, "AGENTS.md");
	const claude = join(root, "CLAUDE.md");
	const target = existsSync(agents) || !existsSync(claude) ? agents : claude;
	const current = existsSync(target) ? readFileSync(target, "utf8") : "";
	if (current.includes(AGENTS_MARK)) return null;
	writeFileSync(target, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${AGENTS_LINE}`);
	return target;
}

/** C4 (#108): hook, repo config, notes setup, harness detection. */
export async function init(api: string, explicit?: string, opts: { agentsMd?: boolean } = {}): Promise<number> {
	const root = repoRoot();
	if (!root) {
		console.error("Not inside a Git repository.");
		return 1;
	}
	const creds = await loadCredentials(api);
	if (!creds) {
		console.error("Not signed in. Run `appmarket login` first.");
		return 1;
	}
	const { repo, remote } = await resolveRepo(api, creds.token, root, explicit);
	git(["config", "appmarket.repo", repo], { cwd: root });
	git(["config", "appmarket.api", api], { cwd: root });
	if (remote) git(["config", "appmarket.remote", remote], { cwd: root });
	gitOr(["config", "--unset", "appmarket.disabled"], "", { cwd: root });
	const hook = installHook(root);
	// Notes: show them in `git log` and copy them on rebase/amend.
	addConfig(root, "notes.displayRef", "refs/notes/appmarket");
	addConfig(root, "notes.rewriteRef", "refs/notes/appmarket");
	// Fetched notes land beside the local ones (never overwriting them); `git notes merge` combines them.
	if (remote) addConfig(root, `remote.${remote}.fetch`, `+refs/notes/appmarket:refs/notes/remotes/${remote}/appmarket`);

	const harnesses = detectHarnesses();
	// Without a hook adapter (Claude Code and Codex today), the agent reports its prompt over MCP.
	const agentsFile = opts.agentsMd || !(harnesses.includes("claude-code") || harnesses.includes("codex")) ? addAgentsLine(root) : null;
	console.log(`Checkpoints on for ${repo}.`);
	console.log(`  Hook:       ${hook}`);
	console.log(`  Harnesses:  ${harnesses.length ? harnesses.join(", ") : "none found"}${harnesses.includes("claude-code") ? " (run `appmarket adapter install <harness>` to record prompts)" : ""}`);
	console.log(`  Notes:      shown in \`git log\`; ${remote ? `pushed to ${remote} after each checkpoint` : "no appmarket remote found, so they stay local"}`);
	if (agentsFile) console.log(`  Agents:     added a record_context line to ${agentsFile.slice(root.length + 1)}; add the MCP server \`appmarket mcp\` to your agent`);
	console.log("Every commit now gets a checkpoint; agent prompts are added when a harness adapter is installed.");
	return 0;
}

/** C10: capture off or on for this repo; the hook stays and no-ops. */
export function setEnabled(on: boolean): number {
	const root = repoRoot();
	if (!root) {
		console.error("Not inside a Git repository.");
		return 1;
	}
	if (on) gitOr(["config", "--unset", "appmarket.disabled"], "", { cwd: root });
	else git(["config", "appmarket.disabled", "true"], { cwd: root });
	console.log(`Checkpoints ${on ? "enabled" : "disabled"} for this repo.`);
	return 0;
}
