import type { ListingReport, ReportInput, ReportReason } from "@appmarket/shared";

interface ReportRow {
	id: string;
	reason: ReportReason;
	details: string;
	contact: string | null;
	created_at: string;
	resolved_at: string | null;
	resolution: string | null;
	slug: string;
	name: string;
	state: string;
}

/** PRD R18: visitor reports about listings. */
export class Reports {
	constructor(private readonly db: D1Database) {}

	async add(listingId: string, input: ReportInput, reporterId: string | null): Promise<string> {
		const id = crypto.randomUUID();
		await this.db
			.prepare("INSERT INTO listing_reports (id, listing_id, reason, details, contact, reporter_id) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(id, listingId, input.reason, input.details, input.contact, reporterId)
			.run();
		return id;
	}

	async list(status: "open" | "resolved"): Promise<ListingReport[]> {
		const { results } = await this.db
			.prepare(
				`SELECT r.*, l.slug, l.name, l.state FROM listing_reports r JOIN listings l ON l.id = r.listing_id
				 WHERE r.resolved_at IS ${status === "open" ? "" : "NOT "}NULL ORDER BY r.created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 200`,
			)
			.all<ReportRow>();
		return results.map((r) => ({
			id: r.id,
			listing: { slug: r.slug, name: r.name, state: r.state },
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
			.prepare("UPDATE listing_reports SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resolved_by = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL")
			.bind(adminId, resolution, id)
			.run();
		return result.meta.changes > 0;
	}
}
