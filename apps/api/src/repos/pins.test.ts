import { describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { RepoStore } from "./repository.ts";

describe("pins (#142)", () => {
	it("keeps the order, and shows only repos that are still published", async () => {
		const db = testD1();
		seedUser(db.sqlite, "dev");
		db.sqlite.prepare("INSERT INTO owners (id, handle, kind, user_id) VALUES ('dev', 'dev', 'user', 'dev') ON CONFLICT DO NOTHING").run();
		for (const [id, state] of [["a", "published"], ["b", "published"], ["c", "published"]]) {
			db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state) VALUES (?, 'dev', 'dev', ?, ?, 'Summary text', 'ai', ?)`).run(id, id, id.toUpperCase(), state);
		}
		const repos = new RepoStore(db.d1);
		await repos.setPins("dev", ["c", "a"]);
		expect((await repos.pinned("dev")).map((r) => r.id)).toEqual(["c", "a"]);
		db.sqlite.prepare("UPDATE repos SET state = 'unpublished' WHERE id = 'c'").run();
		expect((await repos.pinned("dev")).map((r) => r.id)).toEqual(["a"]);
		await repos.setPins("dev", ["b"]);
		expect((await repos.pinned("dev")).map((r) => r.id)).toEqual(["b"]);
		expect((await repos.listPublicByOwners(["dev"])).map((r) => r.id).sort()).toEqual(["a", "b"]);
	});
});
