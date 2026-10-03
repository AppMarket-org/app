import { SCREENSHOT_LIMITS, type Screenshot } from "@appmarket/shared";
import { sniffImageType } from "./images.ts";

interface ScreenshotRow {
	id: string;
	repo_id: string;
	r2_key: string;
	content_type: string;
	position: number;
}

export type AddResult = { ok: true; screenshot: Screenshot } | { ok: false; status: 400 | 409 | 413 | 415; error: string };

const toScreenshot = (r: ScreenshotRow): Screenshot => ({
	id: r.id,
	url: `/api/media/screenshots/${r.id}`,
	contentType: r.content_type,
	position: r.position,
});

/** PRD R24: repo screenshots. Metadata in D1, bytes in R2. */
export class Screenshots {
	constructor(
		private readonly db: D1Database,
		private readonly bucket: R2Bucket,
	) {}

	async list(repoId: string): Promise<Screenshot[]> {
		const { results } = await this.db
			.prepare("SELECT * FROM repo_screenshots WHERE repo_id = ? ORDER BY position, created_at")
			.bind(repoId)
			.all<ScreenshotRow>();
		return results.map(toScreenshot);
	}

	async add(repoId: string, body: ArrayBuffer): Promise<AddResult> {
		if (body.byteLength === 0) return { ok: false, status: 400, error: "empty" };
		if (body.byteLength > SCREENSHOT_LIMITS.maxBytes) return { ok: false, status: 413, error: "too_large" };
		const contentType = sniffImageType(new Uint8Array(body, 0, Math.min(16, body.byteLength)));
		if (!contentType) return { ok: false, status: 415, error: "unsupported_image" };
		const count = await this.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM repo_screenshots WHERE repo_id = ?").bind(repoId).first<{ n: number; last: number }>();
		if ((count?.n ?? 0) >= SCREENSHOT_LIMITS.maxCount) return { ok: false, status: 409, error: "too_many" };

		const id = crypto.randomUUID();
		const key = `repos/${repoId}/screenshots/${id}`;
		await this.bucket.put(key, body, { httpMetadata: { contentType } });
		const row: ScreenshotRow = { id, repo_id: repoId, r2_key: key, content_type: contentType, position: (count?.last ?? -1) + 1 };
		try {
			await this.db
				.prepare("INSERT INTO repo_screenshots (id, repo_id, r2_key, content_type, size_bytes, position) VALUES (?, ?, ?, ?, ?, ?)")
				.bind(id, repoId, key, contentType, body.byteLength, row.position)
				.run();
		} catch (error) {
			await this.bucket.delete(key);
			throw error;
		}
		return { ok: true, screenshot: toScreenshot(row) };
	}

	async remove(repoId: string, id: string): Promise<boolean> {
		const row = await this.db.prepare("SELECT * FROM repo_screenshots WHERE id = ? AND repo_id = ?").bind(id, repoId).first<ScreenshotRow>();
		if (!row) return false;
		await this.db.prepare("DELETE FROM repo_screenshots WHERE id = ?").bind(id).run();
		await this.bucket.delete(row.r2_key);
		return true;
	}

	async find(id: string): Promise<ScreenshotRow | null> {
		return this.db.prepare("SELECT * FROM repo_screenshots WHERE id = ?").bind(id).first<ScreenshotRow>();
	}

	object(row: ScreenshotRow) {
		return this.bucket.get(row.r2_key);
	}
}
