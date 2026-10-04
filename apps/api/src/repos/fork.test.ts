import { describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { RepoStore } from "./repository.ts";

describe("forks (#26)", () => {
	it("record their source at its published tag and commit", async () => {
		const db = testD1();
		seedUser(db.sqlite, "dev");
		db.sqlite.prepare("INSERT INTO owners (id, handle, kind, user_id) VALUES ('dev', 'dev', 'user', 'dev') ON CONFLICT DO NOTHING").run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state, published_tag, published_commit) VALUES ('src', 'dev', 'dev', 'source', 'Source', 'Summary text', 'ai', 'published', 'v1.0.0', ?)`).run("c".repeat(40));
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category) VALUES ('copy', 'dev', 'dev', 'copy', 'Copy', 'Summary text', 'ai')`).run();
		const repos = new RepoStore(db.d1);
		expect((await repos.findById("copy"))?.forkedFrom).toBeNull();
		await repos.setForkedFrom("copy", (await repos.findById("src"))!);
		expect((await repos.findById("copy"))?.forkedFrom).toEqual({ fullName: "dev/source", tag: "v1.0.0", commit: "c".repeat(40) });
	});
});
