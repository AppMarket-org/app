import { describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { nextNumber } from "./numbers.ts";

describe("nextNumber", () => {
	it("counts issues and pull requests together, after existing pull requests", async () => {
		const db = testD1();
		seedUser(db.sqlite, "owner");
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, git_repo, state) VALUES ('r1', 'owner', 'owner', 'a', 'A', 'Summary text', 'ai', 'a-1', 'draft')`).run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, git_repo, state) VALUES ('r2', 'owner', 'owner', 'b', 'B', 'Summary text', 'ai', 'b-1', 'draft')`).run();
		// A repo that already had pull requests before the counter existed.
		db.sqlite.prepare(`INSERT INTO pull_requests (id, repo_id, number, title, author_id, source_repo_id, source_branch, target_branch) VALUES ('p', 'r1', 4, 't', 'owner', 'r1', 'x', 'main')`).run();
		expect(await nextNumber(db.d1, "r1")).toBe(5);
		expect(await nextNumber(db.d1, "r1")).toBe(6);
		expect(await nextNumber(db.d1, "r2")).toBe(1);
		expect(await Promise.all([nextNumber(db.d1, "r2"), nextNumber(db.d1, "r2")]).then((n) => n.sort())).toEqual([2, 3]);
	});
});
