import { RELEASE_LIMITS, type Release, type ReleasePlatform, type ReleaseUpload } from "@appmarket/shared";

interface ReleaseRow {
	id: string;
	listing_id: string;
	tag: string;
	platform: ReleasePlatform;
	filename: string;
	r2_key: string;
	size_bytes: number;
	sha256: string;
	downloads: number;
	created_at: string;
}

export type AddReleaseResult = { ok: true; release: Release } | { ok: false; status: 409 | 422; error: string };

const toRelease = (r: ReleaseRow): Release => ({
	id: r.id,
	tag: r.tag,
	platform: r.platform,
	filename: r.filename,
	sizeBytes: r.size_bytes,
	sha256: r.sha256,
	downloads: r.downloads,
	createdAt: r.created_at,
});

/** PRD R5/R13: release binaries. Metadata in D1, bytes in R2 (never in Git). */
export class Releases {
	constructor(
		private readonly db: D1Database,
		private readonly bucket: R2Bucket,
	) {}

	async list(listingId: string, tag?: string): Promise<Release[]> {
		const { results } = await this.db
			.prepare(`SELECT * FROM releases WHERE listing_id = ?${tag ? " AND tag = ?" : ""} ORDER BY created_at DESC LIMIT 200`)
			.bind(...(tag ? [listingId, tag] : [listingId]))
			.all<ReleaseRow>();
		return results.map(toRelease);
	}

	async find(id: string): Promise<(ReleaseRow & { listingId: string }) | null> {
		const row = await this.db.prepare("SELECT * FROM releases WHERE id = ?").bind(id).first<ReleaseRow>();
		return row ? { ...row, listingId: row.listing_id } : null;
	}

	/**
	 * Streams the body into R2. R2 checks the SHA-256 the developer declared and rejects a
	 * mismatching upload, so a corrupted or tampered file is never stored.
	 */
	async add(listingId: string, userId: string, meta: ReleaseUpload, body: ReadableStream, sizeBytes: number): Promise<AddReleaseResult> {
		const count = await this.db.prepare("SELECT COUNT(*) AS n FROM releases WHERE listing_id = ? AND tag = ?").bind(listingId, meta.tag).first<{ n: number }>();
		if ((count?.n ?? 0) >= RELEASE_LIMITS.maxPerVersion) return { ok: false, status: 409, error: "too_many" };
		const duplicate = await this.db
			.prepare("SELECT 1 FROM releases WHERE listing_id = ? AND tag = ? AND platform = ? AND filename = ?")
			.bind(listingId, meta.tag, meta.platform, meta.filename)
			.first();
		if (duplicate) return { ok: false, status: 409, error: "exists" };

		const id = crypto.randomUUID();
		const key = `listings/${listingId}/releases/${id}`;
		try {
			await this.bucket.put(key, body, { sha256: meta.sha256, httpMetadata: { contentType: "application/octet-stream" } });
		} catch (error) {
			if (/sha-?256|checksum|digest/i.test(String(error))) return { ok: false, status: 422, error: "checksum_mismatch" };
			throw error;
		}
		const stored = await this.bucket.head(key);
		if (!stored || stored.size !== sizeBytes) {
			await this.bucket.delete(key);
			return { ok: false, status: 422, error: "incomplete_upload" };
		}
		try {
			await this.db
				.prepare("INSERT INTO releases (id, listing_id, tag, platform, filename, r2_key, size_bytes, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
				.bind(id, listingId, meta.tag, meta.platform, meta.filename, key, stored.size, meta.sha256, userId)
				.run();
		} catch (error) {
			await this.bucket.delete(key);
			throw error;
		}
		return { ok: true, release: (await this.list(listingId, meta.tag)).find((r) => r.id === id)! };
	}

	async remove(listingId: string, id: string): Promise<boolean> {
		const row = await this.db.prepare("SELECT * FROM releases WHERE id = ? AND listing_id = ?").bind(id, listingId).first<ReleaseRow>();
		if (!row) return false;
		await this.db.prepare("DELETE FROM releases WHERE id = ?").bind(id).run();
		await this.bucket.delete(row.r2_key);
		return true;
	}

	object(key: string, range?: Headers) {
		return this.bucket.get(key, range ? { range } : undefined);
	}

	async countDownload(id: string): Promise<void> {
		await this.db.prepare("UPDATE releases SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
	}
}
