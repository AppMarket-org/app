import type { RepoReport, ReportInput, ReportReason } from "@appmarket/shared";

interface ReportRow {
	id: string;
	reason: ReportReason;
	details: string;
	contact: string | null;
	created_at: string;
	resolved_at: string | null;
	resolution: string | null;
	full_name: string;
	name: string;
	state: string;
}

/** PRD R18: visitor reports about repos. */
export class Reports {
	constructor(private readonly db: D1Database) {}

	async add(repoId: string, input: ReportInput, reporterId: string | null): Promise<string> {
		const id = crypto.randomUUID();
		await this.db
			.prepare("INSERT INTO repo_reports (id, repo_id, reason, details, contact, reporter_id) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(id, repoId, input.reason, input.details, input.contact, reporterId)
			.run();
		return id;
	}

	async list(status: "open" | "resolved"): Promise<RepoReport[]> {
		const { results } = await this.db
			.prepare(
				`SELECT r.*, o.handle || '/' || l.slug AS full_name, l.name, l.state FROM repo_reports r JOIN repos l ON l.id = r.repo_id JOIN owners o ON o.id = l.owner_id
				 WHERE r.resolved_at IS ${status === "open" ? "" : "NOT "}NULL ORDER BY r.created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 200`,
			)
			.all<ReportRow>();
		return results.map((r) => ({
			id: r.id,
			repo: { fullName: r.full_name, name: r.name, state: r.state },
			reason: r.reason,
			details: r.details,
			contact: r.contact,
			createdAt: r.created_at,
			resolvedAt: r.resolved_at,
			resolution: r.resolution,
		}));
	}

	/** Resolves an open report once; returns false if it does not exist or was already resolved. */
	async resolve(id: string, adminId: string, resolution: string): Promise<boolean> {
		const result = await this.db
			.prepare("UPDATE repo_reports SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resolved_by = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL")
			.bind(adminId, resolution, id)
			.run();
		return result.meta.changes > 0;
	}
}
