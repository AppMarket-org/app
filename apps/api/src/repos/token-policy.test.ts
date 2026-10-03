import type { Repo } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { tokenPolicy } from "./token-policy.ts";

const repo = (state: Repo["state"], gitRepo: string | null = "app-1234abcd") => ({ state, gitRepo, owner: { id: "owner", name: "O" } }) as Repo;
const owner = { id: "owner", role: "developer" } as const;
const admin = { id: "admin", role: "admin" } as const;
const buyer = { id: "buyer", role: "buyer" } as const;

describe("tokenPolicy", () => {
	it("gives write only to the owner", () => {
		expect(tokenPolicy(repo("draft"), owner, "write")).toEqual({ allowed: true });
		expect(tokenPolicy(repo("published"), admin, "write")).toMatchObject({ allowed: false, status: 403 });
		expect(tokenPolicy(repo("published"), buyer, "write")).toMatchObject({ allowed: false, status: 403 });
	});

	it("gives read to anyone signed in once published, otherwise owner and admin", () => {
		expect(tokenPolicy(repo("published"), buyer, "read")).toEqual({ allowed: true });
		expect(tokenPolicy(repo("draft"), admin, "read")).toEqual({ allowed: true });
		expect(tokenPolicy(repo("submitted"), buyer, "read")).toMatchObject({ allowed: false, status: 404 });
	});

	it("refuses removed repos and repos without a repo", () => {
		expect(tokenPolicy(repo("removed"), owner, "read")).toMatchObject({ allowed: false, status: 409, error: "removed" });
		expect(tokenPolicy(repo("draft", null), owner, "write")).toMatchObject({ allowed: false, status: 409, error: "no_repo" });
	});
});
