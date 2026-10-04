import { beforeEach, describe, expect, it } from "vitest";
import { testD1 } from "../testing/d1.ts";
import { handleFromEmail, OwnerStore } from "./store.ts";

function addUser(sqlite: ReturnType<typeof testD1>["sqlite"], id: string, email: string) {
	sqlite.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, 1, 0, 0, 'developer')`).run(id, id.toUpperCase(), email);
}

describe("handleFromEmail", () => {
	it("hyphenates the local part and avoids reserved or empty names", () => {
		expect(handleFromEmail("Jane.Doe+apps@example.test")).toBe("jane-doe-apps");
		expect(handleFromEmail("admin@example.test")).toBe("user");
		expect(handleFromEmail("__@example.test")).toBe("user");
	});
});

describe("OwnerStore", () => {
	let db: ReturnType<typeof testD1>;
	let store: OwnerStore;

	beforeEach(() => {
		db = testD1();
		addUser(db.sqlite, "u1", "jane@example.test");
		addUser(db.sqlite, "u2", "jane@other.test");
		addUser(db.sqlite, "u3", "sam@example.test");
		store = new OwnerStore(db.d1);
	});

	it("gives each user a unique handle once", async () => {
		const first = await store.forUser({ id: "u1", email: "jane@example.test" });
		const second = await store.forUser({ id: "u2", email: "jane@other.test" });
		expect([first.handle, second.handle]).toEqual(["jane", "jane-2"]);
		expect((await store.forUser({ id: "u1", email: "jane@example.test" })).handle).toBe("jane");
		expect(first).toMatchObject({ id: "u1", kind: "user", name: "U1" });
	});

	it("renames only to a free handle, case-insensitively", async () => {
		await store.forUser({ id: "u1", email: "jane@example.test" });
		await store.forUser({ id: "u3", email: "sam@example.test" });
		expect(await store.rename("u3", "JANE".toLowerCase())).toBe(false);
		expect(await store.rename("u3", "samuel")).toBe(true);
		expect((await store.byHandle("Samuel"))?.id).toBe("u3");
	});

	it("creates organizations in the same namespace with the creator as owner", async () => {
		await store.forUser({ id: "u1", email: "jane@example.test" });
		expect(await store.createOrg("u1", "jane", "Clash")).toBeNull();
		const org = await store.createOrg("u1", "acme", "Acme Inc");
		expect(org).toMatchObject({ handle: "acme", kind: "org", name: "Acme Inc" });
		expect(await store.membershipsOf("u1")).toEqual([{ org, role: "owner" }]);
		expect(await store.orgIdsOf("u1")).toEqual([org!.id]);
	});

	it("manages members and counts owners", async () => {
		for (const [id, email] of [["u1", "jane@example.test"], ["u3", "sam@example.test"]] as const) await store.forUser({ id, email });
		const org = (await store.createOrg("u1", "acme", "Acme"))!;
		await store.setMember(org.id, "u3", "member");
		expect((await store.members(org.id)).map((m) => [m.handle, m.role])).toEqual([["jane", "owner"], ["sam", "member"]]);
		await store.setMember(org.id, "u3", "owner");
		expect(await store.ownerCount(org.id)).toBe(2);
		await store.removeMember(org.id, "u3");
		expect(await store.roleIn(org.id, "u3")).toBeNull();
	});

	it("stores profile fields, leaves empty ones out, and falls back to the sign-in name (#139)", async () => {
		const jane = await store.forUser({ id: "u1", email: "jane@example.test" });
		expect(await store.profile(jane.id)).toEqual({ memberSince: "1970-01-01T00:00:00.000Z" });
		await store.updateProfile(jane.id, { name: "Jane Doe", bio: "Builds Workers.", website: "https://jane.example.test" });
		expect(await store.profile(jane.id)).toEqual({ bio: "Builds Workers.", website: "https://jane.example.test", memberSince: "1970-01-01T00:00:00.000Z" });
		expect((await store.byId(jane.id))?.name).toBe("Jane Doe");
		await store.updateProfile(jane.id, { name: null, bio: null });
		expect((await store.byId(jane.id))?.name).toBe("U1");
		expect(await store.profile(jane.id)).toEqual({ website: "https://jane.example.test", memberSince: "1970-01-01T00:00:00.000Z" });
	});
});

describe("avatars (#140)", () => {
	it("prefers an upload, falls back to the sign-in picture (https only), and returns the replaced id", async () => {
		const db = testD1();
		db.sqlite.prepare(`INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt, role) VALUES ('u9', 'Nine', 'nine@example.test', 1, 'https://lh3.example.test/p.png', 0, 0, 'developer')`).run();
		const store = new OwnerStore(db.d1);
		const nine = await store.forUser({ id: "u9", email: "nine@example.test" });
		expect(nine.avatarUrl).toBe("https://lh3.example.test/p.png");
		expect(await store.setAvatar(nine.id, { id: "11111111-1111-1111-1111-111111111111", contentType: "image/webp" })).toBeNull();
		expect((await store.byId(nine.id))?.avatarUrl).toBe("/api/media/avatars/11111111-1111-1111-1111-111111111111");
		expect(await store.avatar("11111111-1111-1111-1111-111111111111")).toEqual({ ownerId: nine.id, contentType: "image/webp" });
		expect(await store.setAvatar(nine.id, null)).toBe("11111111-1111-1111-1111-111111111111");
		db.sqlite.prepare(`UPDATE "user" SET image = 'http://insecure.example.test/p.png' WHERE id = 'u9'`).run();
		expect((await store.byId(nine.id))?.avatarUrl).toBeNull();
	});
});

describe("profileUpdateSchema", () => {
	it("validates lengths and https-only websites, and turns empty strings into null", async () => {
		const { profileUpdateSchema } = await import("@appmarket/shared/schemas");
		expect(profileUpdateSchema.parse({ bio: "", website: "https://example.test/me" })).toEqual({ bio: null, website: "https://example.test/me" });
		expect(profileUpdateSchema.safeParse({ website: "http://example.test" }).success).toBe(false);
		expect(profileUpdateSchema.safeParse({ website: "javascript:alert(1)" }).success).toBe(false);
		expect(profileUpdateSchema.safeParse({ bio: "x".repeat(161) }).success).toBe(false);
		expect(profileUpdateSchema.safeParse({ role: "admin" }).success).toBe(false);
	});
});
