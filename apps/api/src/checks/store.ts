import type { CheckResult } from "./commands.ts";

export type RunStatus = "queued" | "running" | "passed" | "failed" | "error";
export interface CheckRun {
	id: string;
	commit: string;
	trigger: "push" | "submit";
	status: RunStatus;
	results: CheckResult[] | null;
	createdAt: string;
	finishedAt: string | null;
}

interface Row {
	id: string;
	commit_sha: string;
	trigger: "push" | "submit";
	status: RunStatus;
	results: string | null;
	created_at: string;
	finished_at: string | null;
}

const toRun = (r: Row): CheckRun => ({ id: r.id, commit: r.commit_sha, trigger: r.trigger, status: r.status, results: r.results ? (JSON.parse(r.results) as CheckResult[]) : null, createdAt: r.created_at, finishedAt: r.finished_at });

/** #27 */
export class CheckStore {
	constructor(private readonly db: D1Database) {}

	async create(id: string, repoId: string, commit: string, trigger: "push" | "submit"): Promise<void> {
		await this.db.prepare("INSERT INTO repo_checks (id, repo_id, commit_sha, trigger, status) VALUES (?, ?, ?, ?, 'queued')").bind(id, repoId, commit, trigger).run();
	}

	async setStatus(id: string, status: RunStatus, results?: CheckResult[]): Promise<void> {
		const done = status === "passed" || status === "failed" || status === "error";
		await this.db
			.prepare(`UPDATE repo_checks SET status = ?, results = COALESCE(?, results), finished_at = ${done ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : "finished_at"} WHERE id = ?`)
			.bind(status, results ? JSON.stringify(results) : null, id)
			.run();
	}

	/** The newest run for a commit (any trigger). */
	async latestFor(repoId: string, commit: string): Promise<CheckRun | null> {
		const row = await this.db.prepare("SELECT * FROM repo_checks WHERE repo_id = ? AND commit_sha = ? ORDER BY created_at DESC LIMIT 1").bind(repoId, commit).first<Row>();
		return row ? toRun(row) : null;
	}

	async recent(repoId: string, limit = 20): Promise<CheckRun[]> {
		const { results } = await this.db.prepare("SELECT * FROM repo_checks WHERE repo_id = ? ORDER BY created_at DESC LIMIT ?").bind(repoId, limit).all<Row>();
		return results.map(toRun);
	}
}
