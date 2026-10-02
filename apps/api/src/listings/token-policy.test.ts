import type { Listing } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { tokenPolicy } from "./token-policy.ts";

const listing = (state: Listing["state"], repoName: string | null = "app-1234abcd") => ({ state, repoName, owner: { id: "owner", name: "O" } }) as Listing;
const owner = { id: "owner", role: "developer" } as const;
const admin = { id: "admin", role: "admin" } as const;
const buyer = { id: "buyer", role: "buyer" } as const;

describe("tokenPolicy", () => {
	it("gives write only to the owner", () => {
		expect(tokenPolicy(listing("draft"), owner, "write")).toEqual({ allowed: true });
		expect(tokenPolicy(listing("published"), admin, "write")).toMatchObject({ allowed: false, status: 403 });
		expect(tokenPolicy(listing("published"), buyer, "write")).toMatchObject({ allowed: false, status: 403 });
	});

	it("gives read to anyone signed in once published, otherwise owner and admin", () => {
		expect(tokenPolicy(listing("published"), buyer, "read")).toEqual({ allowed: true });
		expect(tokenPolicy(listing("draft"), admin, "read")).toEqual({ allowed: true });
		expect(tokenPolicy(listing("submitted"), buyer, "read")).toMatchObject({ allowed: false, status: 404 });
	});

	it("refuses removed listings and listings without a repo", () => {
		expect(tokenPolicy(listing("removed"), owner, "read")).toMatchObject({ allowed: false, status: 409, error: "removed" });
		expect(tokenPolicy(listing("draft", null), owner, "write")).toMatchObject({ allowed: false, status: 409, error: "no_repo" });
	});
});
