import { beforeEach, describe, expect, it } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";
import { TokenAudit } from "./token-audit.ts";

describe("TokenAudit", () => {
	let audit: TokenAudit;
	let sqlite: ReturnType<typeof testD1>["sqlite"];

	beforeEach(() => {
		const db = testD1();
		sqlite = db.sqlite;
		seedUser(sqlite, "owner");
		seedUser(sqlite, "admin", "admin");
		sqlite.prepare(`INSERT INTO repos (id, owner_id, slug, name, summary, category, git_repo) VALUES ('l1', 'owner', 'a', 'A', 'Summary text', 'ai', 'a-1')`).run();
		audit = new TokenAudit(db.d1);
	});

	it("lists mints newest first with live state, never the token", async () => {
		const future = new Date(Date.now() + 3_600_000).toISOString();
		await audit.recordMint({ repoId: "l1", userId: "owner", tokenId: "t1", scope: "write", expiresAt: future });
		await audit.recordMint({ repoId: "l1", userId: "owner", tokenId: "t2", scope: "read", expiresAt: "2000-01-01T00:00:00Z" });
		const items = await audit.list("l1", [{ id: "t1", state: "active" }]);
		expect(items.map((t) => [t.id, t.state])).toEqual([
			["t2", "expired"],
			["t1", "active"],
		]);
		expect(JSON.stringify(items)).not.toContain("art_v");
	});

	it("records a revocation once, keeping the first revoker", async () => {
		await audit.recordMint({ repoId: "l1", userId: "owner", tokenId: "t1", scope: "write", expiresAt: "2999-01-01T00:00:00Z" });
		await audit.recordRevocations("l1", ["t1"], "owner");
		await audit.recordRevocations("l1", ["t1"], "admin");
		const row = sqlite.prepare("SELECT revoked_by, revoked_at FROM token_audit WHERE token_id = 't1'").get() as { revoked_by: string; revoked_at: string };
		expect(row.revoked_by).toBe("owner");
		expect((await audit.list("l1", [{ id: "t1", state: "active" }]))[0]!.state).toBe("revoked");
	});

	it("only knows tokens minted for that repo", async () => {
		await audit.recordMint({ repoId: "l1", userId: "owner", tokenId: "t1", scope: "read", expiresAt: "2999-01-01T00:00:00Z" });
		expect(await audit.isAudited("l1", "t1")).toBe(true);
		expect(await audit.isAudited("l1", "someone-elses-token")).toBe(false);
	});
});
