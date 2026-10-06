/**
 * #294: the repo's next issue or pull request number (one counter for both). Atomic: two requests
 * at once get different numbers. A repo without a counter row starts after its last pull request.
 */
export async function nextNumber(db: D1Database, repoId: string): Promise<number> {
	const row = await db
		.prepare(
			`INSERT INTO repo_numbers (repo_id, last)
			 VALUES (?, MAX(COALESCE((SELECT MAX(number) FROM pull_requests WHERE repo_id = ?), 0), COALESCE((SELECT MAX(number) FROM issues WHERE repo_id = ?), 0)) + 1)
			 ON CONFLICT (repo_id) DO UPDATE SET last = last + 1
			 RETURNING last`,
		)
		.bind(repoId, repoId, repoId)
		.first<{ last: number }>();
	return row!.last;
}
