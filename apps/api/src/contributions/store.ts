/** A commit as Artifacts reports it (seconds or milliseconds since the epoch). */
export interface ScannedCommit {
	hash: string;
	author: { name: string; email: string };
	authoredAt: number;
}

const utcDay = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);

/** #143: the contributions table. */
export class ContributionStore {
	constructor(private readonly db: D1Database) {}

	/**
	 * Copies repo creations, version submissions, release uploads and checkpoints since `since`
	 * (ISO; omit for all) into contributions. Idempotent.
	 */
	async syncEvents(since = ""): Promise<void> {
		await this.db.batch([
			this.db.prepare(`INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day) SELECT 'repo', id, id, created_by, substr(created_at, 1, 10) FROM repos WHERE created_at >= ?`).bind(since),
			this.db
				.prepare(
					`INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day) SELECT 'version', repo_id, CAST(id AS TEXT), actor_id, substr(created_at, 1, 10) FROM repo_events
					 WHERE to_state = 'submitted' AND actor_role = 'owner' AND created_at >= ?`,
				)
				.bind(since),
			this.db.prepare(`INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day) SELECT 'release', repo_id, id, uploaded_by, substr(created_at, 1, 10) FROM releases WHERE created_at >= ?`).bind(since),
			this.db
				.prepare(
					`INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day) SELECT 'checkpoint', repo_id, commit_sha, uploaded_by, substr(received_at, 1, 10) FROM checkpoints
					 WHERE uploaded_by IS NOT NULL AND state != 'missing' AND received_at >= ?`,
				)
				.bind(since),
		]);
	}

	/**
	 * Records commits for the users whose verified email is the commit's author email. Commits by
	 * anyone else (or unverified emails) are not attributed. Returns how many were new.
	 */
	async addCommits(repoId: string, commits: ScannedCommit[]): Promise<number> {
		const emails = [...new Set(commits.map((c) => c.author.email.trim().toLowerCase()).filter(Boolean))];
		if (!emails.length) return 0;
		const users = new Map<string, string>();
		for (let i = 0; i < emails.length; i += 90) {
			const chunk = emails.slice(i, i + 90);
			const { results } = await this.db
				.prepare(`SELECT id, lower(email) AS email FROM "user" WHERE emailVerified = 1 AND lower(email) IN (${chunk.map(() => "?").join(",")})`)
				.bind(...chunk)
				.all<{ id: string; email: string }>();
			for (const r of results) users.set(r.email, r.id);
		}
		const inserts = commits.flatMap((c) => {
			const userId = users.get(c.author.email.trim().toLowerCase());
			return userId
				? [this.db.prepare("INSERT OR IGNORE INTO contributions (kind, repo_id, ref, user_id, day) VALUES ('commit', ?, ?, ?, ?)").bind(repoId, c.hash, userId, utcDay(c.authoredAt))]
				: [];
		});
		let added = 0;
		for (let i = 0; i < inserts.length; i += 50) {
			const results = await this.db.batch(inserts.slice(i, i + 50));
			added += results.reduce((n, r) => n + r.meta.changes, 0);
		}
		return added;
	}
}
