import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkers } from "../plane/merge-commands";
import { syncScript } from "./commands";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sh = (env: Record<string, string>) => parseMarkers(execFileSync("sh", ["-c", syncScript], { encoding: "utf8", env: { ...process.env, ...env } }));

function commit(dir: string, file: string, text: string, message: string): string {
	writeFileSync(join(dir, file), text);
	git(dir, "add", file);
	git(dir, "commit", "-qm", message);
	return git(dir, "rev-parse", "HEAD");
}

/** A template (bare) tagged v1, and a buyer's fork of it with a commit of their own. */
function setup() {
	const root = mkdtempSync(join(tmpdir(), "am-sync-"));
	const up = join(root, "up.git");
	git(root, "init", "-q", "--bare", "-b", "main", up);
	const author = join(root, "author");
	git(root, "clone", "-q", up, author);
	for (const [k, v] of [["user.name", "Author"], ["user.email", "a@x.test"]]) git(author, "config", k!, v!);
	git(author, "checkout", "-q", "-b", "main");
	commit(author, "a.txt", "a\n", "v1");
	git(author, "tag", "v1");
	git(author, "push", "-q", "origin", "main", "--tags");
	const fork = join(root, "fork.git");
	git(root, "clone", "-q", "--bare", up, fork);
	const buyer = join(root, "buyer");
	git(root, "clone", "-q", fork, buyer);
	for (const [k, v] of [["user.name", "Buyer"], ["user.email", "b@x.test"]]) git(buyer, "config", k!, v!);
	commit(buyer, "mine.txt", "mine\n", "buyer's change");
	git(buyer, "push", "-q", "origin", "main");
	return { up, fork, author };
}

const env = (s: ReturnType<typeof setup>, tag: string) => ({ UP_REMOTE: s.up, UP_TOKEN: "t", FORK_REMOTE: s.fork, FORK_TOKEN: "t", TAG: tag, BASE: "main", BRANCH: `appmarket/upstream/${tag}` });

describe("upstream sync script (#73)", () => {
	it("pushes a new template version to the fork as a branch", () => {
		const s = setup();
		const v2 = commit(s.author, "b.txt", "b\n", "v2: a fix");
		git(s.author, "tag", "v2");
		git(s.author, "push", "-q", "origin", "main", "--tags");
		expect(sh(env(s, "v2"))).toMatchObject({ status: "pushed", head: v2 });
		expect(git(s.fork, "rev-parse", "refs/heads/appmarket/upstream/v2")).toBe(v2);
	});

	it("says when the fork already has the version, or the tag is missing", () => {
		const s = setup();
		expect(sh(env(s, "v1")).status).toBe("current");
		expect(sh(env(s, "v9")).status).toBe("no_tag");
	});
});
