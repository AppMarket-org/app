import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-rw-"));
const { checkpoint } = await import("./checkpoint.ts");
const { rewritten } = await import("./rewritten.ts");
const { append, bufferKey } = await import("../buffer.ts");

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const note = (cwd: string, sha: string) => JSON.parse(git(cwd, "notes", "--ref=appmarket", "show", sha));

describe("post-rewrite", () => {
	it("copies a checkpoint to the amended commit with rewritten_from, adding new prompts", () => {
		const dir = mkdtempSync(join(tmpdir(), "am-rw-repo-"));
		git(dir, "init", "-q");
		const root = git(dir, "rev-parse", "--show-toplevel");
		git(root, "config", "user.name", "Dev");
		git(root, "config", "user.email", "dev@example.test");
		git(root, "config", "appmarket.repo", "dev/app");
		git(root, "config", "appmarket.api", "http://localhost:9");
		const key = bufferKey(root);
		append(key, { v: 1, ts: new Date().toISOString(), type: "prompt", harness: "claude-code", text: "first" });
		writeFileSync(join(root, "a.txt"), "a");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "a");
		const oldSha = git(root, "rev-parse", "HEAD");
		checkpoint({ cwd: root, noSync: true, hook: true });
		append(key, { v: 1, ts: new Date().toISOString(), type: "prompt", harness: "claude-code", text: "second" });
		writeFileSync(join(root, "b.txt"), "b");
		git(root, "add", "-A");
		git(root, "commit", "-q", "--amend", "-m", "a+b");
		const newSha = git(root, "rev-parse", "HEAD");
		rewritten("amend", `${oldSha} ${newSha}\n`, root);
		const record = note(root, newSha);
		expect(record).toMatchObject({ commit: newSha, rewritten_from: oldSha, harness: "claude-code" });
		expect(record.prompts.map((p: { text: string }) => p.text)).toEqual(["first", "second"]);
		expect(record.files.map((f: { path: string }) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
		// The old commit keeps its checkpoint as history.
		expect(note(root, oldSha).commit).toBe(oldSha);
	});
});
