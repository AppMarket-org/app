import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoState, TransitionRequest } from "@appmarket/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { transitionUpdate } from "./transition-sql.ts";

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

function freshDb() {
	const db = new Database(":memory:");
	for (const file of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
	db.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES ('u1', 'Dev', 'd@x.test', 1, 0, 0, 'developer')`).run();
	db.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES ('a1', 'Admin', 'a@x.test', 1, 0, 0, 'admin')`).run();
	db.prepare(`INSERT INTO owners (id, handle, kind, user_id) VALUES ('u1', 'dev', 'user', 'u1')`).run();
	db.prepare(`INSERT INTO repos (id, owner_id, created_by, slug, name, summary, category) VALUES ('l1', 'u1', 'u1', 'app', 'App', 'Summary text', 'ai')`).run();
	return db;
}

function apply(db: Database.Database, from: RepoState, request: TransitionRequest, commit: string | null = null, checks: string | null = null) {
	const { sql, params } = transitionUpdate({ id: "l1", state: from }, request, "a1", commit, checks);
	return db.prepare(sql).run(...params).changes;
}

const row = (db: Database.Database) => db.prepare("SELECT * FROM repos WHERE id = 'l1'").get() as Record<string, unknown>;

describe("transitionUpdate", () => {
	let db: Database.Database;
	beforeEach(() => {
		db = freshDb();
	});

	it("binds exactly the parameters of every transition and pins the reviewed commit", () => {
		expect(apply(db, "draft", { to: "submitted", tag: "v1", releaseNotes: "First release" }, "c1")).toBe(1);
		expect(row(db)).toMatchObject({ state: "submitted", submitted_tag: "v1", submitted_commit: "c1", submitted_notes: "First release" });
		expect(apply(db, "submitted", { to: "draft" })).toBe(1);
		expect(row(db)).toMatchObject({ state: "draft", submitted_tag: null, submitted_commit: null, submitted_notes: null });
		const checks = JSON.stringify({ warnings: [], manifest: { resources: [{ type: "d1", binding: "DB", name: "db" }], envVars: [], secrets: ["KEY"] } });
		expect(apply(db, "draft", { to: "submitted", tag: "v1", releaseNotes: "" }, "c1", checks)).toBe(1);
		expect(row(db)).toMatchObject({ submitted_checks: checks });
		expect(apply(db, "submitted", { to: "published" })).toBe(1);
		expect(row(db)).toMatchObject({ state: "published", published_tag: "v1", published_commit: "c1", approved_by: "a1", submitted_tag: null, submitted_checks: null });
		expect(JSON.parse(row(db).published_manifest as string)).toEqual(JSON.parse(checks).manifest);
		expect(apply(db, "published", { to: "unpublished" })).toBe(1);
		expect(apply(db, "unpublished", { to: "submitted", tag: "v1", releaseNotes: "" }, "c2")).toBe(1);
		expect(row(db)).toMatchObject({ submitted_commit: "c2", published_commit: "c1" });
		expect(apply(db, "submitted", { to: "removed" })).toBe(1);
		expect(row(db)).toMatchObject({ state: "removed", published_commit: "c1" });
	});

	it("matches nothing when the repo has already moved on", () => {
		expect(apply(db, "submitted", { to: "published" })).toBe(0);
		expect(row(db)).toMatchObject({ state: "draft" });
	});
});
