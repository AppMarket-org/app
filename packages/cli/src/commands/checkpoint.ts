import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { advanceMarker, bufferKey, readSinceMarker, type BufferEvent } from "../buffer.ts";
import { transcriptEvents } from "../adapters/claude-code.ts";
import { buildRecord, type CommitInfo } from "../build-record.ts";
import { apiBase, HOME } from "../config.ts";
import { git, gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { enqueue } from "../queue.ts";
import { createRedactor, envValues } from "../redact.ts";

/** The commit being checkpointed: HEAD, its parents, branch, author and diff stat. */
function commitInfo(root: string, sha: string): CommitInfo {
	const [name = "", email = "", committedAt = new Date().toISOString()] = git(["log", "-1", "--format=%an%x00%ae%x00%cI", sha], { cwd: root }).split("\0");
	const parents = gitOr(["rev-list", "--parents", "-n", "1", sha], sha, { cwd: root }).split(" ").slice(1).filter(Boolean);
	// Root commits diff against nothing; merges against their first parent.
	const numstat = parents.length ? gitOr(["diff", "--numstat", parents[0]!, sha], "", { cwd: root }) : gitOr(["show", "--numstat", "--format=", sha], "", { cwd: root });
	const files = numstat
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [added = "0", removed = "0", ...path] = line.split("\t");
			return { path: path.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
		});
	const branch = gitOr(["rev-parse", "--abbrev-ref", "HEAD"], "", { cwd: root });
	return { commit: sha, parents, branch: branch === "HEAD" ? "" : branch, author: { name, email }, committedAt, files };
}

/** User and repo redaction settings: ~/.appmarket/config.json and .appmarket.json ({"redact": [regex, ...]}), .appmarketignore. */
function redactionSettings(root: string): { extra: string[]; ignore: string[] } {
	const read = (path: string) => {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as { redact?: string[] };
		} catch {
			return {};
		}
	};
	const ignore = (() => {
		try {
			return readFileSync(join(root, ".appmarketignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
		} catch {
			return [];
		}
	})();
	return { extra: [...(read(join(HOME, "config.json")).redact ?? []), ...(read(join(root, ".appmarket.json")).redact ?? [])], ignore };
}

/** Claude Code: adds model, effort, usage and the assistant's last text from each session transcript in the window. */
function withTranscripts(events: BufferEvent[], committedAt: string): BufferEvent[] {
	const until = new Date(Date.parse(committedAt) + 2000).toISOString();
	// Per transcript: where to start reading (an optimisation) and the earliest event of this window
	// (the bound: a session that ended before this window contributes nothing).
	const windows = new Map<string, { offset: number; since: string }>();
	for (const e of events) {
		if (!e.transcript_path) continue;
		const w = windows.get(e.transcript_path) ?? { offset: Number.POSITIVE_INFINITY, since: e.ts };
		if (e.transcript_offset !== undefined) w.offset = Math.min(w.offset, e.transcript_offset);
		if (e.ts < w.since) w.since = e.ts;
		windows.set(e.transcript_path, w);
	}
	return [...events, ...[...windows].flatMap(([path, w]) => transcriptEvents(path, Number.isFinite(w.offset) ? w.offset : 0, until, w.since))];
}

/**
 * C7 (#109, #110): build the checkpoint for a commit (HEAD by default), redact it, write the local
 * git note, queue the upload and advance the buffer marker. Exits 0 in every case: a commit never
 * fails because of a checkpoint.
 */
export function checkpoint(flags: { hook?: boolean; commit?: string; noSync?: boolean; force?: boolean; cwd?: string }): number {
	try {
		const root = repoRoot(flags.cwd);
		if (!root) return 0;
		if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;
		const repo = gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root });
		if (!repo) {
			if (!flags.hook) console.error("This repo is not set up. Run `appmarket init`.");
			return 0;
		}
		const api = gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
		const sha = git(["rev-parse", flags.commit ?? "HEAD"], { cwd: root });
		// One checkpoint per commit: the git hook and the Claude Code fast path both land here.
		if (!flags.force && gitOr(["notes", "--ref=appmarket", "list", sha], "", { cwd: root })) return 0;
		const key = bufferKey(root);
		const settings = redactionSettings(root);
		const info = commitInfo(root, sha);
		const events = withTranscripts(readSinceMarker(key), info.committedAt);
		const record = buildRecord(events, info, createRedactor({ envValues: envValues(root), ...settings }));
		// Local note first, so it travels with any push even if the upload never happens.
		git(["notes", "--ref=appmarket", "add", "-f", "-F", "-", sha], { cwd: root, input: JSON.stringify(record, null, 2) });
		enqueue(api, repo, record);
		advanceMarker(key);
		if (!flags.noSync) {
			// C14: upload detached so the hook returns immediately.
			spawn(process.execPath, [process.argv[1]!, "sync", "--quiet"], { detached: true, stdio: "ignore", env: process.env }).unref();
		}
		if (!flags.hook) console.log(`Checkpoint for ${sha.slice(0, 7)} (${record.harness}, ${record.prompts.length} prompt${record.prompts.length === 1 ? "" : "s"}, ${record.redactions} redacted).`);
	} catch (error) {
		log("checkpoint failed", error);
	}
	return 0;
}
