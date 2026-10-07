import type { Repo } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import type { AuthVariables } from "../auth/middleware.ts";
import { canBrowse, canView, isPublic } from "./access.ts";

const repo = (state: Repo["state"], visibility: Repo["visibility"]) => ({ state, visibility, owner: { id: "owner" } }) as Repo;
const session = (id: string, role = "developer") => ({ user: { id, role }, orgIds: [] }) as unknown as AuthVariables["session"];

describe("#366 repo visibility", () => {
	it("public repos are readable by anyone; published ones always are; removed ones never", () => {
		expect(isPublic(repo("draft", "public"))).toBe(true);
		expect(isPublic(repo("draft", "private"))).toBe(false);
		expect(isPublic(repo("published", "private"))).toBe(true);
		expect(isPublic(repo("removed", "public"))).toBe(false);
		expect(canView(repo("draft", "public"), null)).toBe(true);
		expect(canView(repo("unpublished", "public"), null)).toBe(true);
	});

	it("private repos only to their owner and admins", () => {
		expect(canView(repo("draft", "private"), null)).toBe(false);
		expect(canView(repo("draft", "private"), session("someone"))).toBe(false);
		expect(canView(repo("draft", "private"), session("owner"))).toBe(true);
		expect(canView(repo("draft", "private"), session("admin", "admin"))).toBe(true);
	});

	it("any branch of a public repo for everyone, but only the published version of a paid app", () => {
		expect(canBrowse(repo("draft", "public"), null)).toBe(true);
		expect(canBrowse({ ...repo("published", "public"), priceCents: 0 } as Repo, null)).toBe(true);
		expect(canBrowse({ ...repo("published", "public"), priceCents: 500 } as Repo, null)).toBe(false);
		expect(canBrowse({ ...repo("published", "public"), priceCents: 500 } as Repo, session("owner"))).toBe(true);
		expect(canBrowse(repo("draft", "private"), null)).toBe(false);
	});
});
