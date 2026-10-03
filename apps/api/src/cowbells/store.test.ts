import { beforeEach, describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { CowbellStore } from "./store.ts";

describe("CowbellStore", () => {
	let store: CowbellStore;

	beforeEach(() => {
		const db = testD1();
		for (const id of ["owner", "u1", "u2"]) seedUser(db.sqlite, id);
		const insert = db.sqlite.prepare(`INSERT INTO repos (id, owner_id, slug, name, summary, category, git_repo, state) VALUES (?, 'owner', ?, ?, 'Summary text', 'ai', ?, ?)`);
		insert.run("r1", "a", "A", "a-1", "published");
		insert.run("r2", "b", "B", "b-1", "published");
		insert.run("r3", "c", "C", "c-1", "draft");
		store = new CowbellStore(db.d1);
	});

	it("rings once per user and keeps the count in step", async () => {
		expect(await store.set("u1", "r1", true)).toEqual({ cowbelled: true, count: 1 });
		expect(await store.set("u1", "r1", true)).toEqual({ cowbelled: true, count: 1 });
		expect(await store.set("u2", "r1", true)).toEqual({ cowbelled: true, count: 2 });
		expect(await store.status(null, "r1")).toEqual({ cowbelled: false, count: 2 });
		expect(await store.set("u1", "r1", false)).toEqual({ cowbelled: false, count: 1 });
		expect(await store.set("u1", "r1", false)).toEqual({ cowbelled: false, count: 1 });
	});

	it("lists a user's public cowbelled repos", async () => {
		await store.set("u1", "r1", true);
		await store.set("u1", "r2", true);
		await store.set("u1", "r3", true);
		expect((await store.repoIdsFor("u1")).sort()).toEqual(["r1", "r2"]);
	});
});
