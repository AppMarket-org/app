import { spawnSync } from "node:child_process";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { SESSION_REMOTE } from "./session.ts";

const REF = "refs/notes/appmarket";

/** Git without prompts: a push that would ask for credentials fails instead of hanging a background job. */
function run(cwd: string, args: string[]): { ok: boolean; err: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }, timeout: 60_000 });
	return { ok: r.status === 0, err: (r.stderr ?? "").trim() };
}

/**
 * #110/#123: Artifacts cannot write notes server-side, so the CLI pushes refs/notes/appmarket to
 * the appmarket remote (with the credentials git already has for it). When another machine pushed
 * notes first, they are fetched and merged (this machine's record wins on the same commit), then
 * pushed again. Silent; failures go to cli.log. `git config appmarket.pushNotes false` turns it off.
 */
export function pushNotes(cwd?: string): number {
	const root = repoRoot(cwd);
	if (!root) return 0;
	const remote = gitOr(["config", "--get", "appmarket.remote"], "", { cwd: root });
	if (gitOr(["config", "--get", "appmarket.pushNotes"], "", { cwd: root }) === "false") return 0;
	if (!gitOr(["rev-parse", "--verify", "--quiet", REF], "", { cwd: root })) return 0;
	// #70: during an agent session (#29) the commits go to the session's fork, so its notes go there
	// too; the repo itself still gets them, so they are in place once the work is merged.
	const session = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root }) ? SESSION_REMOTE : "";
	for (const target of [remote, session].filter(Boolean)) pushTo(root, target);
	return 0;
}

function pushTo(root: string, remote: string): void {
	for (let attempt = 0; attempt < 3; attempt++) {
		const push = run(root, ["push", "--quiet", remote, `${REF}:${REF}`]);
		if (push.ok) return;
		if (!/rejected|non-fast-forward|fetch first/i.test(push.err)) {
			log(`notes push to ${remote} failed: ${push.err.split("\n")[0]}`);
			return;
		}
		const tracking = `refs/notes/remotes/${remote}/appmarket`;
		const fetch = run(root, ["fetch", "--quiet", remote, `+${REF}:${tracking}`]);
		if (!fetch.ok) {
			log(`notes fetch from ${remote} failed: ${fetch.err.split("\n")[0]}`);
			return;
		}
		const merge = run(root, ["-c", "user.name=appmarket", "-c", "user.email=notes@appmarket.org", "notes", `--ref=${REF}`, "merge", "--quiet", "-s", "ours", tracking]);
		if (!merge.ok) {
			log(`notes merge failed: ${merge.err.split("\n")[0]}`);
			return;
		}
	}
	log(`notes push to ${remote}: gave up after 3 attempts`);
}
