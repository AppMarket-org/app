import type { TokenRecord } from "@appmarket/shared";

interface AuditRow {
	token_id: string;
	scope: "read" | "write";
	user_id: string;
	user_name: string;
	created_at: string;
	expires_at: string;
	revoked_at: string | null;
}

/** PRD R19: audit trail of token mints and revocations (token ids only, never tokens). */
export class TokenAudit {
	constructor(private readonly db: D1Database) {}

	async recordMint(entry: { listingId: string; userId: string; tokenId: string; scope: "read" | "write"; expiresAt: string }): Promise<void> {
		await this.db
			.prepare("INSERT INTO token_audit (listing_id, user_id, scope, expires_at, token_id) VALUES (?, ?, ?, ?, ?)")
			.bind(entry.listingId, entry.userId, entry.scope, entry.expiresAt, entry.tokenId)
			.run();
	}

	async recordRevocations(listingId: string, tokenIds: string[], revokedBy: string): Promise<void> {
		if (tokenIds.length === 0) return;
		await this.db.batch(
			tokenIds.map((id) =>
				this.db
					.prepare(
						"UPDATE token_audit SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_by = ? WHERE listing_id = ? AND token_id = ? AND revoked_at IS NULL",
					)
					.bind(revokedBy, listingId, id),
			),
		);
	}

	async isAudited(listingId: string, tokenId: string): Promise<boolean> {
		return !!(await this.db.prepare("SELECT 1 FROM token_audit WHERE listing_id = ? AND token_id = ?").bind(listingId, tokenId).first());
	}

	/** Mints for a listing, newest first, with live state merged in from Artifacts. */
	async list(listingId: string, live: { id: string; state: "active" | "expired" | "revoked" }[]): Promise<TokenRecord[]> {
		const { results } = await this.db
			.prepare(
				`SELECT t.token_id, t.scope, t.user_id, u.name AS user_name, t.created_at, t.expires_at, t.revoked_at
				 FROM token_audit t JOIN "user" u ON u.id = t.user_id
				 WHERE t.listing_id = ? AND t.token_id IS NOT NULL ORDER BY t.id DESC LIMIT 200`,
			)
			.bind(listingId)
			.all<AuditRow>();
		const states = new Map(live.map((t) => [t.id, t.state]));
		return results.map((r) => ({
			id: r.token_id,
			scope: r.scope,
			state: r.revoked_at ? "revoked" : (states.get(r.token_id) ?? (Date.parse(r.expires_at) < Date.now() ? "expired" : "unknown")),
			mintedBy: { id: r.user_id, name: r.user_name },
			createdAt: r.created_at,
			expiresAt: r.expires_at,
			revokedAt: r.revoked_at,
		}));
	}
}
