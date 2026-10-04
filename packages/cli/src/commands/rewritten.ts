import { spawn } from "node:child_process";
import type { CheckpointRecord } from "@appmarket/shared";
import { advanceMarker, bufferKey, readSinceMarker } from "../buffer.ts";
import { buildRecord } from "../build-record.ts";
import { apiBase } from "../config.ts";
import { git, gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";
import { enqueue } from "../queue.ts";
import { createRedactor, envValues } from "../redact.ts";
import { checkpoint, commitInfo, redactionSettings, withTranscripts } from "./checkpoint.ts";

function noteOf(root: string, sha: string): CheckpointRecord | null {
	try {
		const record = JSON.parse(git(["notes", "--ref=appmarket", "show", sha], { cwd: root })) as CheckpointRecord;
		// After git copied a note (notes.rewriteRef), the copy still names the old commit.
		return record.schema === "appmarket.checkpoint/1" ? record : null;
	} catch {
		return null;
	}
}

/**
 * #125: git's post-rewrite hook (`amend` or `rebase`, "old new" pairs on stdin). Each new commit
 * gets the old commit's record with `rewritten_from` set and its own parents, branch and files; an
 * amend also adds whatever was recorded since the original commit. The old checkpoint stays as
 * history. Always exits 0.
 */
export function rewritten(kind: string, stdin: string, cwd?: string): number {
	try {
		const root = repoRoot(cwd);
		if (!root) return 0;
		if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;
		const repo = gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root });
		if (!repo) return 0;
		const api = gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
		const pairs = stdin
			.split("\n")
			.map((l) => l.trim().split(/\s+/))
			.filter((p) => p.length >= 2 && /^[0-9a-f]{40,64}$/.test(p[0]!) && /^[0-9a-f]{40,64}$/.test(p[1]!));
		let sent = 0;
		for (const [oldSha, newSha] of pairs as [string, string][]) {
			const original = noteOf(root, oldSha);
			if (!original) {
				// Amending a commit that never had a checkpoint: checkpoint the new one normally.
				if (kind === "amend") checkpoint({ hook: true, commit: newSha, cwd: root, force: true, noSync: true });
				continue;
			}
			const info = commitInfo(root, newSha);
			const record: CheckpointRecord = {
				...original,
				commit: newSha,
				parents: info.parents,
				branch: info.branch || original.branch,
				files: info.files.slice(0, 2000),
				rewritten_from: oldSha,
				created_at: new Date().toISOString(),
			};
			if (kind === "amend") {
				// Prompts and tools recorded between the original commit and the amend belong to it too.
				const key = bufferKey(root);
				const events = withTranscripts(readSinceMarker(key), info.committedAt);
				if (events.some((e) => e.type === "prompt" || e.type === "tool")) {
					const extra = buildRecord(events, info, createRedactor({ envValues: envValues(root), ...redactionSettings(root) }));
					record.prompts = [...original.prompts, ...extra.prompts];
					record.tools = [...original.tools, ...extra.tools].slice(-200);
					record.effort_metrics = {
						turns: original.effort_metrics.turns + extra.effort_metrics.turns,
						wall_clock_s: original.effort_metrics.wall_clock_s + extra.effort_metrics.wall_clock_s,
						tool_calls: original.effort_metrics.tool_calls + extra.effort_metrics.tool_calls,
						retries: original.effort_metrics.retries + extra.effort_metrics.retries,
						reasoning_tokens: original.effort_metrics.reasoning_tokens === null && extra.effort_metrics.reasoning_tokens === null ? null : (original.effort_metrics.reasoning_tokens ?? 0) + (extra.effort_metrics.reasoning_tokens ?? 0),
					};
					if (extra.assistant_summary) record.assistant_summary = extra.assistant_summary;
					record.redactions = original.redactions + extra.redactions;
				}
				advanceMarker(key);
			}
			git(["notes", "--ref=appmarket", "add", "-f", "-F", "-", newSha], { cwd: root, input: JSON.stringify(record, null, 2) });
			// Replaces anything already uploaded for the new SHA.
			enqueue(api, repo, record, { force: true });
			sent++;
		}
		if (sent) spawn(process.execPath, [process.argv[1]!, "sync", "--quiet"], { detached: true, stdio: "ignore", env: process.env }).unref();
	} catch (error) {
		log("post-rewrite failed", error);
	}
	return 0;
}
