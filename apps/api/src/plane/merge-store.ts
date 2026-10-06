import type { CheckpointRecord } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { hashOf } from "../checkpoints/store.ts";

export type MergeStatus = "queued" | "rebasing" | "checking" | "merging" | "merged" | "conflict" | "failed";

/** On the board, a task can also wait for its pull request's review (#260). */
export type TaskMergeStatus = MergeStatus | "review";

export interface MergeRow {
	id: string;
	repo_id: string;
	/** The repo the branch lives in: the repo itself, a fork, or an agent session's fork. */
	source_repo_id: string;
	/** A board task (#236) or a pull request (#256) this merge is for. */
	task_id: string | null;
	session_id: string | null;
	pull_id: string | null;
	branch: string;
	base_branch: string | null;
	status: MergeStatus;
	base_sha: string | null;
	head_sha: string | null;
	checks_run_id: string | null;
	details: string | null;
	error: string | null;
}

/** What the board shows for a task's latest merge. */
export interface TaskMerge {
	id: string;
	status: TaskMergeStatus;
	sha: string | null;
	error: string | null;
	conflicts?: string[];
	/** The pull request opened for the task, when the board asks for review. */
	pull?: number;
}

export const loadMerge = (id: string) => env.DB.prepare("SELECT * FROM merges WHERE id = ?").bind(id).first<MergeRow>();

export async function updateMerge(id: string, fields: Partial<Omit<MergeRow, "id">>): Promise<void> {
	const keys = Object.keys(fields) as (keyof typeof fields)[];
	const done = fields.status === "merged" || fields.status === "conflict" || fields.status === "failed";
	await env.DB.prepare(
		`UPDATE merges SET ${keys.map((k) => `${k} = ?`).join(", ")}${done ? ", finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : ""} WHERE id = ?`,
	)
		.bind(...keys.map((k) => fields[k] ?? null), id)
		.run();
}

/**
 * The rebased commits are new commits: each gets a copy of its original's checkpoint (record names
 * the new commit, rewritten_from the old one), so build history and the G5 backstop see them.
 */
export async function copyCheckpoints(repoId: string, pairs: [string, string][]): Promise<number> {
	let copied = 0;
	for (let i = 0; i < pairs.length; i += 50) {
		const batch = pairs.slice(i, i + 50);
		const olds = new Map(batch.map(([o, n]) => [o, n]));
		const { results } = await env.DB.prepare(`SELECT * FROM checkpoints WHERE repo_id = ? AND commit_sha IN (${batch.map(() => "?").join(",")})`)
			.bind(repoId, ...batch.map(([o]) => o))
			.all<Record<string, unknown>>();
		const inserts = [];
		for (const row of results) {
			const old = row.commit_sha as string;
			const next = olds.get(old)!;
			const record = { ...(JSON.parse(row.record as string) as CheckpointRecord), commit: next, rewritten_from: old };
			const copy: Record<string, unknown> = { ...row, commit_sha: next, record: JSON.stringify(record), record_hash: await hashOf(record) };
			delete copy.received_at;
			const cols = Object.keys(copy);
			inserts.push(env.DB.prepare(`INSERT OR IGNORE INTO checkpoints (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => copy[c] ?? null)));
		}
		if (inserts.length) copied += (await env.DB.batch(inserts)).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
	}
	return copied;
}
