import type { CowbellStatus } from "@appmarket/shared";

/**
 * Cowbells (appmarket's stars): one per user per repo. Ringing and un-ringing are idempotent, and
 * the repo's count is recomputed in the same batch so it never drifts.
 */
export class CowbellStore {
	constructor(private readonly db: D1Database) {}

	async set(userId: string, repoId: string, on: boolean): Promise<CowbellStatus> {
		const change = on
			? this.db.prepare("INSERT OR IGNORE INTO cowbells (user_id, repo_id) VALUES (?, ?)").bind(userId, repoId)
			: this.db.prepare("DELETE FROM cowbells WHERE user_id = ? AND repo_id = ?").bind(userId, repoId);
		const recount = this.db.prepare("UPDATE repos SET cowbell_count = (SELECT COUNT(*) FROM cowbells WHERE repo_id = ?) WHERE id = ?").bind(repoId, repoId);
		await this.db.batch([change, recount]);
		return this.status(userId, repoId);
	}

	async status(userId: string | null, repoId: string): Promise<CowbellStatus> {
		const row = await this.db
			.prepare("SELECT cowbell_count AS count, EXISTS (SELECT 1 FROM cowbells WHERE user_id = ? AND repo_id = ?) AS cowbelled FROM repos WHERE id = ?")
			.bind(userId ?? "", repoId, repoId)
			.first<{ count: number; cowbelled: number }>();
		return { cowbelled: !!row?.cowbelled, count: row?.count ?? 0 };
	}

	/** Public repos the user rang, newest cowbell first. */
	async repoIdsFor(userId: string): Promise<string[]> {
		const { results } = await this.db
			.prepare("SELECT c.repo_id FROM cowbells c JOIN repos r ON r.id = c.repo_id WHERE c.user_id = ? AND r.state = 'published' ORDER BY c.created_at DESC LIMIT 100")
			.bind(userId)
			.all<{ repo_id: string }>();
		return results.map((r) => r.repo_id);
	}
}
