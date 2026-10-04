import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

/**
 * Minimal D1Database over in-memory SQLite with every migration applied, for unit tests of
 * D1 code (prepare/bind/first/all/run/batch). Not a full D1 emulation.
 */
export function testD1(): { d1: D1Database; sqlite: Database.Database } {
	const sqlite = new Database(":memory:");
	for (const file of readdirSync(MIGRATIONS).sort()) sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));

	const statement = (sql: string, params: unknown[] = []) => {
		const stmt = sqlite.prepare(sql);
		const reader = stmt.reader;
		return {
			bind: (...next: unknown[]) => statement(sql, next),
			first: async <T>() => (reader ? ((stmt.get(...params) as T) ?? null) : null),
			all: async <T>() => ({ results: (reader ? stmt.all(...params) : []) as T[], success: true, meta: {} }),
			run: async () => runSync(),
			runSync,
		};
		function runSync() {
			const info = reader ? { changes: 0 } : stmt.run(...params);
			return { results: [], success: true, meta: { changes: info.changes } };
		}
	};

	const d1 = {
		prepare: (sql: string) => statement(sql),
		// Like D1: all statements in one transaction, resolving to each statement's result.
		batch: async (stmts: ReturnType<typeof statement>[]) => sqlite.transaction(() => stmts.map((s) => s.runSync()))(),
	};
	return { d1: d1 as unknown as D1Database, sqlite };
}

export function seedUser(sqlite: Database.Database, id: string, role = "developer"): void {
	sqlite
		.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, 1, 0, 0, ?)`)
		.run(id, id, `${id}@example.test`, role);
	// #102: every user has an owner row (handle) with the same id.
	sqlite.prepare(`INSERT INTO owners (id, handle, kind, user_id) VALUES (?, ?, 'user', ?)`).run(id, id.toLowerCase(), id);
}
