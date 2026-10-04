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

	it("does nothing without an appmarket remote or when turned off", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-notes-none-"));
		git(dir, "init", "-q");
		expect(pushNotes(dir)).toBe(0);
	});
});
