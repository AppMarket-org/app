import { spawnSync } from "node:child_process";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";

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
	if (!remote || gitOr(["config", "--get", "appmarket.pushNotes"], "", { cwd: root }) === "false") return 0;
	if (!gitOr(["rev-parse", "--verify", "--quiet", REF], "", { cwd: root })) return 0;
	for (let attempt = 0; attempt < 3; attempt++) {
		const push = run(root, ["push", "--quiet", remote, `${REF}:${REF}`]);
		if (push.ok) return 0;
		if (!/rejected|non-fast-forward|fetch first/i.test(push.err)) {
			log(`notes push to ${remote} failed: ${push.err.split("\n")[0]}`);
			return 0;
		}
		const tracking = `refs/notes/remotes/${remote}/appmarket`;
		const fetch = run(root, ["fetch", "--quiet", remote, `+${REF}:${tracking}`]);
		if (!fetch.ok) {
			log(`notes fetch from ${remote} failed: ${fetch.err.split("\n")[0]}`);
			return 0;
		}
		const merge = run(root, ["-c", "user.name=appmarket", "-c", "user.email=notes@appmarket.org", "notes", `--ref=${REF}`, "merge", "--quiet", "-s", "ours", tracking]);
		if (!merge.ok) {
			log(`notes merge failed: ${merge.err.split("\n")[0]}`);
			return 0;
		}
	}
	log(`notes push to ${remote}: gave up after 3 attempts`);
	return 0;
}
