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

	it("counts per day in a range, published repos only, and lists the years (#144)", async () => {
		const { db, store } = setup();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state) VALUES ('r2', 'dev', 'dev', 'draft-app', 'Draft', 'Summary text', 'ai', 'draft')`).run();
		db.sqlite.prepare("UPDATE repos SET state = 'published' WHERE id = 'r1'").run();
		await store.addCommits("r1", [commit("a", "dev@example.test", "2026-10-02"), commit("b", "dev@example.test", "2026-10-02"), commit("c", "dev@example.test", "2025-03-01")]);
		await store.addCommits("r2", [commit("d", "dev@example.test", "2026-10-02")]);
		expect(await store.calendar("dev", "2026-01-01", "2026-12-31")).toEqual({ days: { "2026-10-02": 2 }, total: 2, years: [2026, 2025] });
		expect((await store.calendar("dev", "2026-10-03", "2026-12-31")).total).toBe(0);
	});

	it("groups activity by month, kind and repo, pages by month, and leaves out unpublished repos (#145)", async () => {
		const { db, store } = setup();
		db.sqlite.prepare("UPDATE repos SET state = 'published' WHERE id = 'r1'").run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state, created_at) VALUES ('r2', 'dev', 'dev', 'secret', 'Secret', 'Summary text', 'ai', 'draft', '2026-10-01T00:00:00Z')`).run();
		await store.addCommits("r1", [commit("a", "dev@example.test", "2026-10-02"), commit("b", "dev@example.test", "2026-10-03"), commit("c", "dev@example.test", "2026-08-01"), commit("e", "dev@example.test", "2026-06-01"), commit("f", "dev@example.test", "2026-05-01")]);
		await store.addCommits("r2", [commit("d", "dev@example.test", "2026-10-02")]);
		await store.syncEvents();
		const first = await store.activity({ userId: "dev" }, "2026-01-01", "2027-01-01");
		expect(first.months.map((m) => m.month)).toEqual(["2026-10", "2026-08", "2026-06"]);
		expect(first.months[0]!.groups).toEqual([
			{ kind: "commit", total: 2, repos: [{ fullName: "dev/app", name: "App", count: 2 }] },
			{ kind: "repo", total: 1, repos: [{ fullName: "dev/app", name: "App", count: 1 }] },
		]);
		expect(first.next).toBe("2026-06-01");
		const second = await store.activity({ userId: "dev" }, "2026-01-01", first.next!);
		expect(second).toEqual({ months: [{ month: "2026-05", groups: [{ kind: "commit", total: 1, repos: [{ fullName: "dev/app", name: "App", count: 1 }] }] }], next: null });
		expect((await store.activity({ ownerId: "dev" }, "2026-10-01", "2026-11-01")).months[0]!.groups[0]!.total).toBe(2);
		expect(JSON.stringify(first)).not.toContain("secret");
	});
});
