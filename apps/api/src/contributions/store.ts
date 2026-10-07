import type { ActivityMonth, ActivityPage, ContributionCalendar, ContributionKind } from "@appmarket/shared";

const PUBLIC = "(r.state = 'published' OR (r.visibility = 'public' AND r.state != 'removed'))";

/** Who is looking at a profile: signed out (null), or a user with their organizations. */
export type ContributionViewer = { id: string; orgIds: readonly string[]; admin: boolean } | null;

/**
 * Repos `viewer` can open (as repos/access.ts canView): public ones, and private ones they own
 * or belong to through an organization; admins all. Removed repos never.
 */
export function visibleTo(viewer: ContributionViewer): { sql: string; binds: string[] } {
	if (viewer?.admin) return { sql: "r.state != 'removed'", binds: [] };
	const mine = viewer ? [viewer.id, ...viewer.orgIds] : [];
	if (!mine.length) return { sql: PUBLIC, binds: [] };
	return { sql: `(${PUBLIC} OR (r.state != 'removed' AND r.owner_id IN (${mine.map(() => "?").join(",")})))`, binds: mine };
}

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
	 * #144: a user's contributions per day in [from, to], plus the years that have any and the repos
	 * they went to (most first). Counted in the repos `viewer` can open (published ones, and private
	 * ones they own or belong to through an organization); with `anonymous` (the user's opt-in, #146)
	 * the rest count too, as numbers only. Removed repos never count.
	 */
	async calendar(userId: string, from: string, to: string, viewer: ContributionViewer = null, anonymous = false): Promise<Omit<ContributionCalendar, "from" | "to">> {
		const seen = visibleTo(viewer);
		const counted = anonymous ? { sql: "r.state != 'removed'", binds: [] as string[] } : seen;
		const [days, years, repos] = await this.db.batch<{ day?: string; n?: number; year?: string; full_name?: string; name?: string; state?: string; visibility?: string }>([
			this.db
				.prepare(`SELECT c.day, COUNT(*) AS n FROM contributions c JOIN repos r ON r.id = c.repo_id WHERE c.user_id = ? AND ${counted.sql} AND c.day BETWEEN ? AND ? GROUP BY c.day`)
				.bind(userId, ...counted.binds, from, to),
			this.db.prepare(`SELECT DISTINCT substr(c.day, 1, 4) AS year FROM contributions c JOIN repos r ON r.id = c.repo_id WHERE c.user_id = ? AND ${counted.sql} ORDER BY year DESC`).bind(userId, ...counted.binds),
			this.db
				.prepare(
					`SELECT o.handle || '/' || r.slug AS full_name, r.name, r.state, r.visibility, COUNT(*) AS n FROM contributions c JOIN repos r ON r.id = c.repo_id JOIN owners o ON o.id = r.owner_id
					 WHERE c.user_id = ? AND ${seen.sql} AND c.day BETWEEN ? AND ? GROUP BY r.id ORDER BY n DESC, full_name`,
				)
				.bind(userId, ...seen.binds, from, to),
		]);
		const map = Object.fromEntries((days!.results ?? []).map((r) => [r.day!, r.n!]));
		return {
			days: map,
			total: Object.values(map).reduce((a, b) => a + b, 0),
			years: (years!.results ?? []).map((r) => Number(r.year)),
			repos: (repos!.results ?? []).map((r) => ({ fullName: r.full_name!, name: r.name!, count: r.n!, private: r.state !== "published" && r.visibility !== "public" })),
		};
	}

	/**
	 * #145: activity by month for a user (their contributions) or an organization (contributions
	 * to its repos), newest first: up to `months` months with activity in [from, before). Repos are
	 * named where `viewer` can open them; with `anonymous` the rest show as a count per month.
	 */
	async activity(subject: { userId: string } | { ownerId: string }, from: string, before: string, months = 3, viewer: ContributionViewer = null, anonymous = false): Promise<ActivityPage> {
		const who = "userId" in subject ? "c.user_id = ?" : "r.owner_id = ?";
		const id = "userId" in subject ? subject.userId : subject.ownerId;
		const seen = visibleTo(viewer);
		const scope = `FROM contributions c JOIN repos r ON r.id = c.repo_id JOIN owners o ON o.id = r.owner_id WHERE ${who} AND c.day >= ? AND c.day < ?`;
		// #146: months with only hidden activity still appear (as a count) when opted in.
		const month = anonymous ? { sql: `${scope} AND r.state != 'removed'`, binds: [] as string[] } : { sql: `${scope} AND ${seen.sql}`, binds: seen.binds };
		const { results: monthRows } = await this.db
			.prepare(`SELECT DISTINCT substr(c.day, 1, 7) AS month ${month.sql} ORDER BY month DESC LIMIT ?`)
			.bind(id, from, before, ...month.binds, months + 1)
			.all<{ month: string }>();
		const shown = monthRows.slice(0, months).map((m) => m.month);
		if (!shown.length) return { months: [], next: null };
		const inShown = `substr(c.day, 1, 7) IN (${shown.map(() => "?").join(",")})`;
		const { results } = await this.db
			.prepare(
				`SELECT substr(c.day, 1, 7) AS month, c.kind, o.handle || '/' || r.slug AS full_name, r.name, r.state, r.visibility, COUNT(*) AS n ${scope} AND ${seen.sql}
				 AND ${inShown} GROUP BY month, c.kind, r.id ORDER BY month DESC, n DESC`,
			)
			.bind(id, from, before, ...seen.binds, ...shown)
			.all<{ month: string; kind: ContributionKind; full_name: string; name: string; state: string; visibility: string; n: number }>();
		const privateCounts = new Map<string, number>();
		if (anonymous) {
			const { results: hidden } = await this.db
				.prepare(`SELECT substr(c.day, 1, 7) AS month, COUNT(*) AS n ${scope} AND r.state != 'removed' AND NOT (${seen.sql}) AND ${inShown} GROUP BY month`)
				.bind(id, from, before, ...seen.binds, ...shown)
				.all<{ month: string; n: number }>();
			for (const h of hidden) privateCounts.set(h.month, h.n);
		}
		const order: ContributionKind[] = ["commit", "repo", "version", "release", "checkpoint"];
		const out: ActivityMonth[] = shown.map((m) => {
			const rows = results.filter((r) => r.month === m);
			return {
				month: m,
				groups: order
					.map((kind) => {
						const repos = rows.filter((r) => r.kind === kind).map((r) => ({ fullName: r.full_name, name: r.name, count: r.n, private: r.state !== "published" && r.visibility !== "public" }));
						return { kind, total: repos.reduce((t, r) => t + r.count, 0), repos };
					})
					.filter((g) => g.total > 0),
				...(privateCounts.get(m) ? { privateCount: privateCounts.get(m) } : {}),
			};
		});
		// The next page ends where this one stopped: before the first day of its oldest month.
		return { months: out, next: monthRows.length > months ? `${shown.at(-1)}-01` : null };
	}

	/** A user's commits in one repo in one month (YYYY-MM), newest day first, and how many there are. */
	async commitRefs(userId: string, repoId: string, month: string, limit: number): Promise<{ shas: string[]; total: number }> {
		const [rows, count] = await this.db.batch<{ ref?: string; n?: number }>([
			this.db.prepare("SELECT ref FROM contributions WHERE user_id = ? AND repo_id = ? AND kind = 'commit' AND substr(day, 1, 7) = ? ORDER BY day DESC LIMIT ?").bind(userId, repoId, month, limit),
			this.db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE user_id = ? AND repo_id = ? AND kind = 'commit' AND substr(day, 1, 7) = ?").bind(userId, repoId, month),
		]);
		return { shas: (rows!.results ?? []).map((r) => r.ref!), total: count!.results?.[0]?.n ?? 0 };
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
