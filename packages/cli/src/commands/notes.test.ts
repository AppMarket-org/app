import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-notes-"));
const { pushNotes } = await import("./notes.ts");

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function clone(remote: string, name: string): string {
	const dir = join(mkdtempSync(join(tmpdir(), "am-notes-")), name);
	git(tmpdir(), "clone", "-q", remote, dir);
	for (const [k, v] of [["user.name", name], ["user.email", `${name}@example.test`], ["appmarket.repo", "dev/app"], ["appmarket.remote", "origin"]]) git(dir, "config", k!, v!);
	return dir;
}

describe("push-notes", () => {
	it("pushes notes, and merges another machine's notes instead of failing", () => {
		const remote = mkdtempSync(join(tmpdir(), "am-notes-remote-"));
		git(remote, "init", "-q", "--bare");
		const a = clone(remote, "a");
		writeFileSync(join(a, "f.txt"), "1");
		git(a, "add", "-A");
		git(a, "commit", "-qm", "one");
		git(a, "push", "-q", "origin", "HEAD:main");
		const one = git(a, "rev-parse", "HEAD");
		const b = clone(remote, "b");
		git(b, "checkout", "-q", "main");
		writeFileSync(join(b, "g.txt"), "2");
		git(b, "add", "-A");
		git(b, "commit", "-qm", "two");
		const two = git(b, "rev-parse", "HEAD");

		git(a, "notes", "--ref=appmarket", "add", "-m", '{"from":"a"}', one);
		pushNotes(a);
		git(b, "notes", "--ref=appmarket", "add", "-m", '{"from":"b"}', two);
		pushNotes(b); // rejected first (a pushed), then fetch + merge + push

		const check = clone(remote, "check");
		git(check, "fetch", "-q", "origin", "refs/notes/appmarket:refs/notes/appmarket");
		expect(git(check, "notes", "--ref=appmarket", "show", one)).toBe('{"from":"a"}');
		expect(git(check, "notes", "--ref=appmarket", "show", two)).toBe('{"from":"b"}');
	});

	it("also pushes notes to the agent session's fork (#70)", () => {
		const remote = mkdtempSync(join(tmpdir(), "am-notes-remote-"));
		git(remote, "init", "-q", "--bare");
		const fork = mkdtempSync(join(tmpdir(), "am-notes-fork-"));
		git(fork, "init", "-q", "--bare");
		const a = clone(remote, "s");
		writeFileSync(join(a, "f.txt"), "1");
		git(a, "add", "-A");
		git(a, "commit", "-qm", "agent work");
		const sha = git(a, "rev-parse", "HEAD");
		git(a, "remote", "add", "appmarket-session", fork);
		git(a, "config", "appmarket.session", "0f8fad5b-d9cb-469f-a165-70867728950e");
		git(a, "push", "-q", "appmarket-session", "HEAD:refs/heads/agent");
		git(a, "notes", "--ref=appmarket", "add", "-m", '{"session":true}', sha);
		pushNotes(a);
		for (const target of [remote, fork]) {
			expect(git(target, "notes", "--ref=appmarket", "show", sha), target).toBe('{"session":true}');
		}
	});

	it("does nothing without an appmarket remote or when turned off", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-notes-none-"));
		git(dir, "init", "-q");
		expect(pushNotes(dir)).toBe(0);
	});
});
