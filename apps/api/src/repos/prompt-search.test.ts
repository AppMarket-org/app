import { describe, expect, it } from "vitest";
import { record } from "../checkpoints/fixtures.ts";
import { CheckpointStore } from "../checkpoints/store.ts";
import { seedUser, testD1 } from "../testing/d1.ts";
import { RepoStore } from "./repository.ts";

describe("search over published prompts (#137)", () => {
	it("finds apps by their published checkpoint prompts, never by private ones", async () => {
		const db = testD1();
		seedUser(db.sqlite, "dev");
		db.sqlite.prepare("INSERT INTO owners (id, handle, kind, user_id) VALUES ('dev', 'dev', 'user', 'dev') ON CONFLICT DO NOTHING").run();
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, state) VALUES ('r1', 'dev', 'dev', 'app', 'App', 'Summary text', 'ai', 'published')`).run();
		const checkpoints = new CheckpointStore(db.d1);
		await checkpoints.put({ id: "r1", path: "dev/app" }, record(1, "Build a quantum flux capacitor"), { state: "attached", visibility: "private", uploadedBy: "dev", device: null, force: false });
		const repos = new RepoStore(db.d1);
		const query: Parameters<RepoStore["search"]>[0] = { q: "flux capacitor", page: 1, pageSize: 20, sort: "newest" };
		expect((await repos.search(query)).items).toEqual([]);
		await checkpoints.setVisibility("r1", "a".repeat(39) + "1", "listing");
		expect((await repos.search(query)).items.map((r) => r.fullName)).toEqual(["dev/app"]);
	});
});
