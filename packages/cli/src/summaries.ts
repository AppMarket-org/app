import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKPOINT_LIMITS, type CheckpointRecord } from "@appmarket/shared";
import { bufferKey } from "./buffer.ts";
import { truncate } from "./build-record.ts";
import { apiBase, ensureDirs, SESSIONS_DIR } from "./config.ts";
import { fitRecord } from "./fit.ts";
import { git, gitOr } from "./git.ts";
import { log } from "./log.ts";
import { enqueue } from "./queue.ts";
import { createRedactor, envValues } from "./redact.ts";
import { redactionSettings } from "./commands/checkpoint.ts";

/**
 * An agent usually commits in the middle of its turn and sums up the work at the end. A checkpoint
 * is made at the commit, so its assistant_summary would be whatever the agent said just before
 * (often "Now a test:"). The commits checkpointed in a session wait here; when the turn ends
 * (Claude Code's Stop hook, Cursor's afterAgentResponse, OpenCode's final message) their summary
 * becomes the agent's final reply, and the note and the upload are replaced.
 */
const fileFor = (root: string) => join(SESSIONS_DIR, `${bufferKey(root)}.summaries.json`);

type Pending = Record<string, string[]>;

function read(root: string): Pending {
	try {
		return JSON.parse(readFileSync(fileFor(root), "utf8")) as Pending;
	} catch {
		return {};
	}
}

/** Remembers a commit checkpointed in an agent session, until the session's turn ends. */
export function awaitSummary(root: string, session: string, sha: string): void {
	if (!session) return;
	ensureDirs();
	const pending = read(root);
	pending[session] = [...new Set([...(pending[session] ?? []), sha])].slice(-50);
	writeFileSync(fileFor(root), JSON.stringify(pending), { mode: 0o600 });
}

/**
 * The session's turn ended with `reply`: it becomes the summary of the commits it checkpointed
 * since its last reply. Redacted like the rest of the record. Returns how many were updated.
 */
export function finishSummaries(root: string, session: string, reply: string, opts: { sync?: boolean } = {}): number {
	const text = reply.trim();
	if (!session || !text) return 0;
	const pending = read(root);
	const shas = pending[session];
	if (!shas?.length) return 0;
	delete pending[session];
	if (Object.keys(pending).length) writeFileSync(fileFor(root), JSON.stringify(pending), { mode: 0o600 });
	else rmSync(fileFor(root), { force: true });
	const repo = gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root });
	const api = gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	const redactor = createRedactor({ envValues: envValues(root), ...redactionSettings(root) });
	const summary = truncate(redactor.text(text), CHECKPOINT_LIMITS.assistantSummaryChars);
	let updated = 0;
	for (const sha of shas) {
		try {
			const note = gitOr(["notes", "--ref=appmarket", "show", sha], "", { cwd: root });
			if (!note) continue;
			const record = JSON.parse(note) as CheckpointRecord;
			if (record.session_id !== session || record.assistant_summary === summary) continue;
			const next: CheckpointRecord = { ...record, assistant_summary: summary, redactions: record.redactions + redactor.count };
			git(["notes", "--ref=appmarket", "add", "-f", "-F", "-", sha], { cwd: root, input: JSON.stringify(next, null, 2) });
			if (repo) {
				const fitted = fitRecord(next);
				// The server keeps the first upload unless told to replace it.
				enqueue(api, repo, fitted.record, { force: true, ...(fitted.transcript ? { transcript: fitted.transcript } : {}) });
			}
			updated++;
		} catch (error) {
			log("summary update failed", error);
		}
	}
	if (updated && opts.sync !== false) {
		spawn(process.execPath, [process.argv[1]!, "sync", "--quiet"], { detached: true, stdio: "ignore", env: process.env }).unref();
		spawn(process.execPath, [process.argv[1]!, "push-notes"], { cwd: root, detached: true, stdio: "ignore", env: process.env }).unref();
	}
	return updated;
}
