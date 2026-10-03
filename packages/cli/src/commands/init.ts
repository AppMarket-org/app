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

/** Finds which appmarket repo this checkout is: an explicit owner/slug, or a remote that points at its Artifacts repo. */
async function resolveRepo(api: string, token: string, root: string, explicit?: string): Promise<{ repo: string; remote: string | null }> {
	const remotes = gitOr(["remote", "-v"], "", { cwd: root })
		.split("\n")
		.map((l) => l.split(/\s+/))
		.filter((p) => p.length >= 2)
		.map(([name, url]) => ({ name: name!, url: url! }));
	const { items } = await call<{ items: MineRepo[] }>(api, "/api/repos/mine", { token });
	if (explicit) {
		const match = items.find((r) => r.fullName === explicit);
		if (!match) throw new Error(`${explicit} is not one of your repos (or your organizations').`);
		const remote = remotes.find((r) => match.gitRepo && r.url.includes(`/${match.gitRepo}.git`));
		return { repo: match.fullName, remote: remote?.name ?? null };
	}
	for (const r of remotes) {
		const match = items.find((m) => m.gitRepo && r.url.includes(`/${m.gitRepo}.git`));
		if (match) return { repo: match.fullName, remote: r.name };
	}
	throw new Error("No remote of this checkout points at one of your appmarket.org repos. Run `appmarket init <owner>/<repo>`.");
}

function installHook(root: string): string {
	const hooksDir = resolve(root, git(["rev-parse", "--git-path", "hooks"], { cwd: root }));
	mkdirSync(hooksDir, { recursive: true });
	const hook = join(hooksDir, "post-commit");
	if (existsSync(hook) && !readFileSync(hook, "utf8").includes(MARK)) {
		// Keep the existing hook: ours runs it first as post-commit.local.
		renameSync(hook, join(hooksDir, "post-commit.local"));
	}
	writeFileSync(hook, HOOK);
	chmodSync(hook, 0o755);
	return hook;
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

/** C4 (#108): hook, repo config, notes setup, harness detection. */
export async function init(api: string, explicit?: string): Promise<number> {
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
	console.log(`Checkpoints on for ${repo}.`);
	console.log(`  Hook:       ${hook}`);
	console.log(`  Harnesses:  ${harnesses.length ? harnesses.join(", ") : "none found"}${harnesses.includes("claude-code") ? " (run `appmarket adapter install claude-code` to record prompts)" : ""}`);
	console.log(`  Notes:      shown in \`git log\`; push them with \`git push ${remote ?? "<remote>"} refs/notes/appmarket\``);
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
