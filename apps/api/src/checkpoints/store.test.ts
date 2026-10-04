import { checkpointRecordSchema } from "@appmarket/shared/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { record, sha } from "./fixtures.ts";
import { CheckpointStore } from "./store.ts";

describe("checkpointRecordSchema", () => {
	it("accepts a full record and rejects bad SHAs", () => {
		expect(checkpointRecordSchema.safeParse(record(1)).success).toBe(true);
		expect(checkpointRecordSchema.safeParse({ ...record(1), commit: "abc" }).success).toBe(false);
	});
});

describe("CheckpointStore", () => {
	let store: CheckpointStore;
	let db: ReturnType<typeof testD1>;
	const repo = { id: "r1", path: "dev/app" };
	const meta = { state: "pending" as const, visibility: "private" as const, uploadedBy: "dev", device: "laptop", force: false };

	beforeEach(() => {
		db = testD1();
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
		expect(await store.privateInSession("r1", "s1")).toBe(3);
		expect(await store.setSessionVisibility("r1", "s1", "public")).toBe(3);
		expect(await store.privateInSession("r1", "s1")).toBe(0);
		expect((await store.get(repo, sha(1), "public"))?.visibility).toBe("public");
		await store.attach("r1", [sha(1)]);
		expect((await store.get(repo, sha(1), "owner"))?.state).toBe("attached");
		expect(await store.delete("r1", sha(1))).toBe(true);
		expect(await store.get(repo, sha(1), "owner")).toBeNull();
	});

	it("reconciles a push: attaches pending, adds missing placeholders after the first checkpoint, idempotently (#124)", async () => {
		const commit = (n: number, at: string) => ({ hash: sha(n), parents: [], author: { name: "Dev", email: "dev@example.test" }, committedAt: Date.parse(at) / 1000 });
		// Before any checkpoint exists: no placeholders (old history is not "missing").
		expect(await store.reconcilePushed({ id: "r1", defaultVisibility: "private" }, [commit(9, "2026-01-01T00:00:00Z")], "2026-01-01T00:00:01Z")).toEqual({ attached: 0, missing: 0 });
		await store.put(repo, record(1), meta); // created_at 2026-10-03T10:00:30Z, pending
		const pushed = [commit(1, "2026-10-03T10:00:30Z"), commit(2, "2026-10-03T11:00:00Z"), commit(8, "2026-09-01T00:00:00Z")];
		expect(await store.reconcilePushed({ id: "r1", defaultVisibility: "private" }, pushed, "2026-10-03T12:00:00Z")).toEqual({ attached: 1, missing: 1 });
		expect(await store.reconcilePushed({ id: "r1", defaultVisibility: "private" }, pushed, "2026-10-03T12:00:00Z")).toEqual({ attached: 0, missing: 0 });
		expect(await store.reconciledAt("r1")).toBe("2026-10-03T12:00:00Z");
		expect((await store.get(repo, sha(1), "owner"))?.state).toBe("attached");
		expect(await store.get(repo, sha(2), "owner")).toMatchObject({ state: "missing", harness: "none", prompts: [] });
		expect(await store.get(repo, sha(8), "owner")).toBeNull();
		// The real checkpoint arriving late replaces the placeholder without a conflict.
		const late = await store.put(repo, record(2, "late prompt"), { ...meta, state: "attached" });
		expect(late.status).toBe(200);
		expect(late.checkpoint).toMatchObject({ state: "attached", prompts: [{ text: "late prompt" }] });
	});

	it("redacts what the CLI missed, on late prompts and before anything becomes visible (#128)", async () => {
		const key = "sk-ant-" + "a".repeat(30);
		const leaky = { ...record(5), prompts: [{ ts: "2026-10-03T10:00:00.000Z", text: `use ${key}` }], tools: [{ name: "Bash", args_summary: `export K=${key}`, outcome: "ok" as const, ts: "2026-10-03T10:00:01.000Z" }] };
		// An upload stored as-is (as before this change) is caught by the audit and by a visibility change.
		await store.put(repo, leaky, meta);
		expect((await store.audit()).withSecrets).toEqual([{ repoId: "r1", commit: sha(5) }]);
		await store.setVisibility("r1", sha(5), "public");
		const after = await store.get(repo, sha(5), "owner");
		expect(after?.prompts?.[0]?.text).toBe("use [redacted:anthropic]");
		expect(after?.tools?.[0]?.args_summary).toBe("export K=[redacted:anthropic]");
		expect(after).toMatchObject({ redactions: 2, server_redactions: 2 });
		expect((await store.audit()).withSecrets).toEqual([]);
		await store.addPrompt("r1", sha(5), `and ${key}`);
		expect((await store.get(repo, sha(5), "owner"))?.prompts?.[1]?.text).toBe("and [redacted:anthropic]");
	});

	it("exports the account's checkpoints as JSONL and purges removed repos (#131)", async () => {
		await store.put(repo, record(1), meta);
		await store.put(repo, record(2), meta);
		const lines: string[] = [];
		for await (const line of store.exportLines(["dev"])) lines.push(line);
		expect(lines.map((l) => JSON.parse(l).commit)).toEqual([sha(1), sha(2)]);
		expect(JSON.parse(lines[0]!)).toMatchObject({ repo: "dev/app", prompts: [{ text: "Add a todo list" }] });
		const none: string[] = [];
		for await (const line of store.exportLines(["someone-else"])) none.push(line);
		expect(none).toEqual([]);
		expect(await store.purgeRemovedRepos()).toBe(0);
		db.sqlite.prepare("UPDATE repos SET state = 'removed' WHERE id = 'r1'").run();
		expect(await store.purgeRemovedRepos()).toBe(2);
		expect((await store.list(repo, "owner")).items).toEqual([]);
	});
});
