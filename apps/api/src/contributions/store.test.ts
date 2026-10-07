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
		expect(await store.calendar("dev", "2026-01-01", "2026-12-31")).toEqual({ days: { "2026-10-02": 2 }, total: 2, years: [2026, 2025], repos: [{ fullName: "dev/app", name: "App", count: 2, private: false }] });
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
			{ kind: "commit", total: 2, repos: [{ fullName: "dev/app", name: "App", count: 2, private: false }] },
			{ kind: "repo", total: 1, repos: [{ fullName: "dev/app", name: "App", count: 1, private: false }] },
		]);
		expect(first.next).toBe("2026-06-01");
		const second = await store.activity({ userId: "dev" }, "2026-01-01", first.next!);
		expect(second).toEqual({ months: [{ month: "2026-05", groups: [{ kind: "commit", total: 1, repos: [{ fullName: "dev/app", name: "App", count: 1, private: false }] }] }], next: null });
		expect((await store.activity({ ownerId: "dev" }, "2026-10-01", "2026-11-01")).months[0]!.groups[0]!.total).toBe(2);
		expect(JSON.stringify(first)).not.toContain("secret");
	});

	it("adds unpublished repos as counts only with the opt-in, never removed ones (#146)", async () => {
		const { db, store } = setup();
		db.sqlite.prepare("UPDATE repos SET state = 'published' WHERE id = 'r1'").run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state, created_at) VALUES ('r2', 'dev', 'dev', 'secret', 'Secret', 'Summary text', 'ai', 'draft', '2025-01-01T00:00:00Z')`).run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state, created_at) VALUES ('r3', 'dev', 'dev', 'gone', 'Gone', 'Summary text', 'ai', 'removed', '2025-01-01T00:00:00Z')`).run();
		await store.addCommits("r1", [commit("a", "dev@example.test", "2026-10-02")]);
		await store.addCommits("r2", [commit("b", "dev@example.test", "2026-10-02"), commit("c", "dev@example.test", "2026-09-05")]);
		await store.addCommits("r3", [commit("d", "dev@example.test", "2026-10-02")]);
		expect((await store.calendar("dev", "2026-01-01", "2026-12-31")).total).toBe(1);
		expect((await store.calendar("dev", "2026-01-01", "2026-12-31", null, true)).days).toEqual({ "2026-10-02": 2, "2026-09-05": 1 });
		const page = await store.activity({ userId: "dev" }, "2026-09-01", "2026-11-01", 3, null, true);
		expect(page.months.map((m) => [m.month, m.privateCount ?? 0])).toEqual([
			["2026-10", 1],
			["2026-09", 1],
		]);
		expect(page.months[1]!.groups).toEqual([]);
		expect(JSON.stringify(page)).not.toMatch(/secret|gone/i);
	});

	it("names private repos to the people who can open them: the user, the repo's org members, admins; never others", async () => {
		const { db, store } = setup();
		db.sqlite.prepare("INSERT INTO owners (id, handle, kind) VALUES ('acme', 'acme', 'org')").run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state) VALUES ('r2', 'acme', 'dev', 'secret', 'Secret', 'Summary text', 'ai', 'draft')`).run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state) VALUES ('r3', 'dev', 'dev', 'mine', 'Mine', 'Summary text', 'ai', 'draft')`).run();
		await store.addCommits("r2", [commit("a", "dev@example.test", "2026-10-02"), commit("b", "dev@example.test", "2026-10-03")]);
		await store.addCommits("r3", [commit("c", "dev@example.test", "2026-10-02")]);
		const range = ["dev", "2026-01-01", "2026-12-31"] as const;
		const self = { id: "dev", orgIds: ["acme"], admin: false };
		const member = { id: "someone", orgIds: ["acme"], admin: false };
		const stranger = { id: "stranger", orgIds: [], admin: false };
		expect((await store.calendar(...range, self)).repos).toEqual([
			{ fullName: "acme/secret", name: "Secret", count: 2, private: true },
			{ fullName: "dev/mine", name: "Mine", count: 1, private: true },
		]);
		expect(await store.calendar(...range, member)).toMatchObject({ total: 2, repos: [{ fullName: "acme/secret", count: 2, private: true }] });
		expect(await store.calendar(...range, stranger)).toMatchObject({ total: 0, repos: [] });
		expect((await store.calendar(...range, { id: "root", orgIds: [], admin: true })).total).toBe(3);
		// The opt-in counts the rest for everyone, without names.
		expect(await store.calendar(...range, stranger, true)).toMatchObject({ total: 3, repos: [] });
		const page = await store.activity({ userId: "dev" }, "2026-09-01", "2026-11-01", 3, member, true);
		expect(page.months[0]!.groups[0]!.repos.map((r) => r.fullName)).toEqual(["acme/secret"]);
		expect(page.months[0]!.privateCount).toBe(1);
		expect(JSON.stringify(page)).not.toContain("mine");
		expect(await store.commitRefs("dev", "r2", "2026-10", 10)).toEqual({ shas: ["b".padEnd(40, "0"), "a".padEnd(40, "0")], total: 2 });
	});
});
