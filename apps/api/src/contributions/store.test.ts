import { describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { ContributionStore } from "./store.ts";

function setup() {
	const db = testD1();
	seedUser(db.sqlite, "dev");
	db.sqlite.prepare(`UPDATE "user" SET email = 'Dev@Example.test', emailVerified = 1 WHERE id = 'dev'`).run();
	seedUser(db.sqlite, "unverified");
	db.sqlite.prepare(`UPDATE "user" SET email = 'ghost@example.test', emailVerified = 0 WHERE id = 'unverified'`).run();
	db.sqlite.prepare("INSERT INTO owners (id, handle, kind, user_id) VALUES ('dev', 'dev', 'user', 'dev') ON CONFLICT DO NOTHING").run();
	db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, git_repo, created_at) VALUES ('r1', 'dev', 'dev', 'app', 'App', 'Summary text', 'ai', 'app-1', '2026-10-01T09:00:00Z')`).run();
	return { db, store: new ContributionStore(db.d1) };
}

const commit = (sha: string, email: string, day: string) => ({ hash: sha.padEnd(40, "0"), author: { name: "x", email }, authoredAt: Date.parse(`${day}T12:00:00Z`) / 1000 });

describe("contributions (#143)", () => {
	it("attributes commits by verified email only, and never double counts a re-push", async () => {
		const { db, store } = setup();
		const pushed = [commit("a", "dev@example.test", "2026-10-02"), commit("b", "DEV@example.test", "2026-10-03"), commit("c", "ghost@example.test", "2026-10-03"), commit("d", "stranger@example.test", "2026-10-03")];
		expect(await store.addCommits("r1", pushed)).toBe(2);
		expect(await store.addCommits("r1", pushed)).toBe(0);
		const rows = db.sqlite.prepare("SELECT kind, user_id, day FROM contributions ORDER BY day").all();
		expect(rows).toEqual([
			{ kind: "commit", user_id: "dev", day: "2026-10-02" },
			{ kind: "commit", user_id: "dev", day: "2026-10-03" },
		]);
	});

	it("copies repo creations, submissions, releases and checkpoints idempotently", async () => {
		const { db, store } = setup();
		db.sqlite.prepare(`INSERT INTO repo_events (repo_id, from_state, to_state, actor_id, actor_role, tag, created_at) VALUES ('r1', 'draft', 'submitted', 'dev', 'owner', 'v1', '2026-10-02T10:00:00Z')`).run();
		db.sqlite.prepare(`INSERT INTO repo_events (repo_id, from_state, to_state, actor_id, actor_role, created_at) VALUES ('r1', 'submitted', 'published', 'dev', 'admin', '2026-10-02T11:00:00Z')`).run();
		await store.syncEvents();
		await store.syncEvents();
		const rows = db.sqlite.prepare("SELECT kind, day FROM contributions ORDER BY kind").all();
		expect(rows).toEqual([
			{ kind: "repo", day: "2026-10-01" },
			{ kind: "version", day: "2026-10-02" },
		]);
	});
});
