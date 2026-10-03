import type { CheckpointRecord } from "@appmarket/shared";
import { checkpointRecordSchema } from "@appmarket/shared/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { CheckpointStore } from "./store.ts";

const sha = (n: number) => n.toString(16).padStart(40, "a");
export function record(n: number, prompt = "Add a todo list"): CheckpointRecord {
	return {
		schema: "appmarket.checkpoint/1",
		commit: sha(n),
		parents: [sha(n - 1)],
		branch: "main",
		author: { name: "Dev", email: "dev@example.test" },
		harness: "claude-code",
		harness_version: "2.1.0",
		session_id: "s1",
		model: "claude-opus-5-5",
		effort: { raw: "high", level: "high" },
		effort_metrics: { turns: 1, wall_clock_s: 30, tool_calls: 4, retries: 0, reasoning_tokens: 1200 },
		prompts: [{ ts: "2026-10-03T10:00:00.000Z", text: prompt }],
		assistant_summary: "Added the list.",
		tools: [{ name: "Edit", args_summary: "src/todo.ts", outcome: "ok", ts: "2026-10-03T10:00:10.000Z" }],
		usage: { input_tokens: 1000, output_tokens: 200, cost_usd: null },
		files: [{ path: "src/todo.ts", added: 10, removed: 0 }],
		redactions: 0,
		source: "harness",
		created_at: "2026-10-03T10:00:30.000Z",
	};
}

describe("checkpointRecordSchema", () => {
	it("accepts a full record and rejects bad SHAs", () => {
		expect(checkpointRecordSchema.safeParse(record(1)).success).toBe(true);
		expect(checkpointRecordSchema.safeParse({ ...record(1), commit: "abc" }).success).toBe(false);
	});
});

describe("CheckpointStore", () => {
	let store: CheckpointStore;
	const repo = { id: "r1", path: "dev/app" };
	const meta = { state: "pending" as const, visibility: "private" as const, uploadedBy: "dev", device: "laptop", force: false };

	beforeEach(() => {
		const db = testD1();
		seedUser(db.sqlite, "dev");
		db.sqlite.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category, git_repo) VALUES ('r1', 'dev', 'dev', 'app', 'App', 'Summary text', 'ai', 'app-1')`).run();
		store = new CheckpointStore(db.d1);
	});

	it("creates once, replays identically, and conflicts on a different record", async () => {
		expect((await store.put(repo, record(1), meta)).status).toBe(201);
		expect((await store.put(repo, record(1), meta)).status).toBe(200);
		expect((await store.put(repo, record(1, "Something else"), meta)).status).toBe(409);
		const forced = await store.put(repo, record(1, "Something else"), { ...meta, force: true });
		expect(forced.status).toBe(200);
		expect(forced.checkpoint.prompts?.[0]?.text).toBe("Something else");
	});

	it("never shows private checkpoints to non-owners, and hides the author's email", async () => {
		await store.put(repo, record(1), meta);
		await store.put(repo, { ...record(2), harness: "none" }, meta);
		expect(await store.get(repo, sha(1), "public")).toBeNull();
		expect((await store.list(repo, "public")).items).toEqual([]);
		expect((await store.list(repo, "public")).summary).toEqual({ total: 0, harnesses: {} });
		await store.setVisibility("r1", sha(1), "listing");
		const pub = await store.get(repo, sha(1), "public");
		expect(pub?.prompts?.[0]?.text).toBe("Add a todo list");
		expect(pub?.author).toEqual({ name: "Dev", email: "" });
		expect(pub?.device).toBeNull();
		expect((await store.list(repo, "public")).summary).toEqual({ total: 1, harnesses: { "claude-code": 1 } });
		expect((await store.list(repo, "owner")).summary).toEqual({ total: 2, harnesses: { "claude-code": 1, none: 1 } });
		await store.setVisibility("r1", sha(1), "private");
		expect((await store.list(repo, "public")).items).toEqual([]);
	});

	it("pages newest first and adds late prompts", async () => {
		for (let n = 1; n <= 3; n++) {
			await store.put(repo, record(n), meta);
			await new Promise((r) => setTimeout(r, 5));
		}
		const first = await store.list(repo, "owner", { limit: 2 });
		expect(first.items.map((c) => c.commit)).toEqual([sha(3), sha(2)]);
		const second = await store.list(repo, "owner", { limit: 2, before: first.next! });
		expect(second.items.map((c) => c.commit)).toEqual([sha(1)]);
		expect(second.next).toBeNull();
		expect(await store.addPrompt("r1", sha(1), "Also handle empty lists")).toBe(true);
		expect((await store.get(repo, sha(1), "owner"))?.prompts?.map((p) => p.text)).toEqual(["Add a todo list", "Also handle empty lists"]);
		expect(await store.setSessionVisibility("r1", "s1", "public")).toBe(3);
		expect((await store.get(repo, sha(1), "public"))?.visibility).toBe("public");
		await store.attach("r1", [sha(1)]);
		expect((await store.get(repo, sha(1), "owner"))?.state).toBe("attached");
		expect(await store.delete("r1", sha(1))).toBe(true);
		expect(await store.get(repo, sha(1), "owner")).toBeNull();
	});
});
