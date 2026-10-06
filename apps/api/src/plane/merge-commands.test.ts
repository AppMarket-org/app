import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkers, pushScript, rebaseScript } from "./merge-commands";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sh = (script: string, env: Record<string, string>) => parseMarkers(execFileSync("sh", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } }));

function commit(dir: string, file: string, text: string, message: string): string {
	writeFileSync(join(dir, file), text);
	git(dir, "add", file);
	git(dir, "commit", "-qm", message);
	return git(dir, "rev-parse", "HEAD");
}

/** A repo (bare "main") with a session fork, and working clones of each. */
function setup() {
	const root = mkdtempSync(join(tmpdir(), "am-merge-"));
	const main = join(root, "main.git");
	const fork = join(root, "fork.git");
	git(root, "init", "-q", "--bare", "-b", "main", main);
	const owner = join(root, "owner");
	git(root, "clone", "-q", main, owner);
	for (const [k, v] of [["user.name", "Owner"], ["user.email", "o@x.test"]]) git(owner, "config", k!, v!);
	git(owner, "checkout", "-q", "-b", "main");
	commit(owner, "a.txt", "a\n", "base");
	git(owner, "push", "-q", "origin", "main");
	git(root, "clone", "-q", "--bare", main, fork);
	const agent = join(root, "agent");
	git(root, "clone", "-q", fork, agent);
	for (const [k, v] of [["user.name", "Agent"], ["user.email", "a@x.test"]]) git(agent, "config", k!, v!);
	git(agent, "checkout", "-q", "-b", "agent/feature");
	return { root, main, fork, owner, agent };
}

const env = (s: ReturnType<typeof setup>, extra: Record<string, string>) => ({ MAIN_REMOTE: s.main, MAIN_TOKEN: "t", FORK_REMOTE: s.fork, FORK_TOKEN: "t", BASE: "main", BRANCH: "agent/feature", MERGE_ID: "m1", FORK_REF: "refs/heads/appmarket/merge/m1", ...extra });

describe("merge scripts (#238)", () => {
	it("rebases the agent's branch onto a moved base, carries notes, and fast-forwards the base to the checked commit", () => {
		const s = setup();
		const c1 = commit(s.agent, "b.txt", "b\n", "agent one");
		const c2 = commit(s.agent, "c.txt", "c\n", "agent two");
		git(s.agent, "notes", "--ref=appmarket", "add", "-m", '{"commit":"one"}', c1);
		git(s.agent, "push", "-q", "origin", "agent/feature", "refs/notes/appmarket");
		const moved = commit(s.owner, "d.txt", "d\n", "owner meanwhile");
		git(s.owner, "push", "-q", "origin", "main");

		const r = sh(rebaseScript, env(s, {}));
		expect(r).toMatchObject({ status: "rebased", base: moved, conflicts: [] });
		expect(r.map.map(([old]) => old)).toEqual([c1, c2]);
		const [[, n1]] = r.map as [[string, string]];
		expect(git(s.fork, "rev-parse", "refs/heads/appmarket/merge/m1")).toBe(r.head);
		expect(git(s.fork, "notes", "--ref=appmarket", "show", n1)).toBe('{"commit":"one"}');
		expect(git(s.fork, "log", "-1", "--format=%an %cn", r.head!)).toBe("Agent appmarket");

		const p = sh(pushScript, env(s, { HEAD_SHA: r.head!, BASE_SHA: r.base! }));
		expect(p).toMatchObject({ status: "merged", notes: true });
		expect(git(s.main, "rev-parse", "main")).toBe(r.head);
		expect(git(s.main, "notes", "--ref=appmarket", "show", n1)).toBe('{"commit":"one"}');
	});

	it("reports conflicting files and leaves everything as it was", () => {
		const s = setup();
		commit(s.agent, "a.txt", "agent\n", "agent edits a");
		git(s.agent, "push", "-q", "origin", "agent/feature");
		commit(s.owner, "a.txt", "owner\n", "owner edits a");
		git(s.owner, "push", "-q", "origin", "main");
		const before = git(s.main, "rev-parse", "main");
		expect(sh(rebaseScript, env(s, {}))).toMatchObject({ status: "conflict", conflicts: ["a.txt"], head: null });
		expect(git(s.main, "rev-parse", "main")).toBe(before);
	});

	it("does not push when the base moved after the checks, or the checked commit was replaced", () => {
		const s = setup();
		commit(s.agent, "b.txt", "b\n", "agent");
		git(s.agent, "push", "-q", "origin", "agent/feature");
		const r = sh(rebaseScript, env(s, {}));
		commit(s.owner, "e.txt", "e\n", "owner after checks");
		git(s.owner, "push", "-q", "origin", "main");
		const moved = git(s.main, "rev-parse", "main");
		expect(sh(pushScript, env(s, { HEAD_SHA: r.head!, BASE_SHA: r.base! })).status).toBe("base_moved");
		expect(git(s.main, "rev-parse", "main")).toBe(moved);
		expect(sh(pushScript, env(s, { HEAD_SHA: "f".repeat(40), BASE_SHA: moved })).status).toBe("changed");
	});

	it("fast path: pushes the branch itself when it already contains the base (no rebase), notes included", () => {
		const s = setup();
		const c1 = commit(s.agent, "b.txt", "b\n", "agent, on top of the base");
		git(s.agent, "notes", "--ref=appmarket", "add", "-m", '{"commit":"fast"}', c1);
		git(s.agent, "push", "-q", "origin", "agent/feature", "refs/notes/appmarket");
		const base = git(s.main, "rev-parse", "main");
		const p = sh(pushScript, env(s, { FORK_REF: "refs/heads/agent/feature", HEAD_SHA: c1, BASE_SHA: base }));
		expect(p).toMatchObject({ status: "merged", notes: true });
		expect(git(s.main, "rev-parse", "main")).toBe(c1);
		expect(git(s.main, "notes", "--ref=appmarket", "show", c1)).toBe('{"commit":"fast"}');
		// The branch moved after the checks: nothing is pushed.
		const s2 = setup();
		const d1 = commit(s2.agent, "b.txt", "b\n", "checked");
		commit(s2.agent, "c.txt", "c\n", "pushed after the checks");
		git(s2.agent, "push", "-q", "origin", "agent/feature");
		const base2 = git(s2.main, "rev-parse", "main");
		expect(sh(pushScript, env(s2, { FORK_REF: "refs/heads/agent/feature", HEAD_SHA: d1, BASE_SHA: base2 })).status).toBe("changed");
		expect(git(s2.main, "rev-parse", "main")).toBe(base2);
	});

	it("says when there is nothing to merge or no such branch", () => {
		const s = setup();
		git(s.agent, "push", "-q", "origin", "agent/feature");
		expect(sh(rebaseScript, env(s, {})).status).toBe("nothing");
		expect(sh(rebaseScript, env(s, { BRANCH: "missing" })).status).toBe("no_branch");
	});
});
