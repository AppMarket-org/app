import type { ActivityMonth, ActivityPage, ContributionKind } from "@appmarket/shared";

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
	 * #144: a user's contributions per day in [from, to], counting only published repos (private
	 * contributions are #146), plus the years that have any.
	 */
	async calendar(userId: string, from: string, to: string, includePrivate = false): Promise<{ days: Record<string, number>; total: number; years: number[] }> {
		// #146: with the opt-in, unpublished repos count too (as numbers only; removed ones never).
		const visible = includePrivate ? "r.state != 'removed'" : "r.state = 'published'";
		const [days, years] = await this.db.batch<{ day?: string; n?: number; year?: string }>([
			this.db
				.prepare(`SELECT c.day, COUNT(*) AS n FROM contributions c JOIN repos r ON r.id = c.repo_id WHERE c.user_id = ? AND ${visible} AND c.day BETWEEN ? AND ? GROUP BY c.day`)
				.bind(userId, from, to),
			this.db.prepare(`SELECT DISTINCT substr(c.day, 1, 4) AS year FROM contributions c JOIN repos r ON r.id = c.repo_id WHERE c.user_id = ? AND ${visible} ORDER BY year DESC`).bind(userId),
		]);
		const map = Object.fromEntries((days!.results ?? []).map((r) => [r.day!, r.n!]));
		return { days: map, total: Object.values(map).reduce((a, b) => a + b, 0), years: (years!.results ?? []).map((r) => Number(r.year)) };
	}

	/**
	 * #145: activity by month for a user (their contributions) or an organization (contributions
	 * to its repos), published repos only, newest first: up to `months` months with activity in
	 * [from, before).
	 */
	async activity(subject: { userId: string } | { ownerId: string }, from: string, before: string, months = 3, includePrivate = false): Promise<ActivityPage> {
		const who = "userId" in subject ? "c.user_id = ?" : "r.owner_id = ?";
		const id = "userId" in subject ? subject.userId : subject.ownerId;
		const scope = `FROM contributions c JOIN repos r ON r.id = c.repo_id JOIN owners o ON o.id = r.owner_id WHERE ${who} AND c.day >= ? AND c.day < ?`;
		const base = `${scope} AND r.state = 'published'`;
		// #146: months with only private activity still appear (as a count) when opted in.
		const monthScope = includePrivate ? `${scope} AND r.state != 'removed'` : base;
		const { results: monthRows } = await this.db
			.prepare(`SELECT DISTINCT substr(c.day, 1, 7) AS month ${monthScope} ORDER BY month DESC LIMIT ?`)
			.bind(id, from, before, months + 1)
			.all<{ month: string }>();
		const shown = monthRows.slice(0, months).map((m) => m.month);
		if (!shown.length) return { months: [], next: null };
		const { results } = await this.db
			.prepare(
				`SELECT substr(c.day, 1, 7) AS month, c.kind, o.handle || '/' || r.slug AS full_name, r.name, COUNT(*) AS n ${base}
				 AND substr(c.day, 1, 7) IN (${shown.map(() => "?").join(",")})
				 GROUP BY month, c.kind, r.id ORDER BY month DESC, n DESC`,
			)
			.bind(id, from, before, ...shown)
			.all<{ month: string; kind: ContributionKind; full_name: string; name: string; n: number }>();
		const privateCounts = new Map<string, number>();
		if (includePrivate) {
			const { results: hidden } = await this.db
				.prepare(`SELECT substr(c.day, 1, 7) AS month, COUNT(*) AS n ${scope} AND r.state NOT IN ('published', 'removed') AND substr(c.day, 1, 7) IN (${shown.map(() => "?").join(",")}) GROUP BY month`)
				.bind(id, from, before, ...shown)
				.all<{ month: string; n: number }>();
			for (const h of hidden) privateCounts.set(h.month, h.n);
		}
		const order: ContributionKind[] = ["commit", "repo", "version", "release", "checkpoint"];
		const out: ActivityMonth[] = shown.map((month) => {
			const rows = results.filter((r) => r.month === month);
			return {
				month,
				groups: order
					.map((kind) => {
						const repos = rows.filter((r) => r.kind === kind).map((r) => ({ fullName: r.full_name, name: r.name, count: r.n }));
						return { kind, total: repos.reduce((t, r) => t + r.count, 0), repos };
					})
					.filter((g) => g.total > 0),
				...(privateCounts.get(month) ? { privateCount: privateCounts.get(month) } : {}),
			};
		});
		// The next page ends where this one stopped: before the first day of its oldest month.
		return { months: out, next: monthRows.length > months ? `${shown.at(-1)}-01` : null };
	}

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
