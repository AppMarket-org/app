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
});
