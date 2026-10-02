import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testD1 } from "../testing/d1.ts";

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const env: Record<string, unknown> = {};
vi.mock("cloudflare:workers", () => ({ env }));
const oauth = await import("./oauth.ts");

let sqlite: ReturnType<typeof testD1>["sqlite"];
const fetchMock = vi.fn();

beforeEach(() => {
	const db = testD1();
	sqlite = db.sqlite;
	seedUser(sqlite, "u1");
	seedUser(sqlite, "u2");
	Object.assign(env, { DB: db.d1, PUBLIC_ORIGIN: "https://appmarket.test", CF_OAUTH_CLIENT_ID: "client-id", CF_OAUTH_CLIENT_SECRET: "client-secret", CF_TOKEN_ENCRYPTION_KEY: KEY });
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

const tokenReply = (access: string, refresh = "refresh-1", expiresIn = 3600) =>
	new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expiresIn, scope: "offline_access workers-scripts.edit" }), { status: 200 });

async function connect(user = "u1") {
	const url = new URL(await oauth.authorizationUrl(user, "/dashboard/cloudflare"));
	fetchMock.mockResolvedValueOnce(tokenReply("access-1")).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { email: "buyer@example.test" } })));
	return { url, result: await oauth.completeAuthorization(user, url.searchParams.get("state")!, "code-1") };
}

describe("Cloudflare OAuth", () => {
	it("builds an authorize URL with PKCE, state, scopes and our redirect", async () => {
		const url = new URL(await oauth.authorizationUrl("u1", "/dashboard"));
		expect(url.origin + url.pathname).toBe("https://dash.cloudflare.com/oauth2/auth");
		expect(url.searchParams.get("redirect_uri")).toBe("https://appmarket.test/api/cloudflare/callback");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")).toContain("workers-scripts.edit");
		expect(url.searchParams.get("scope")).toContain("offline_access");
	});

	it("exchanges the code with the client secret and PKCE verifier, storing tokens encrypted", async () => {
		const { result } = await connect();
		expect(result).toEqual({ ok: true, returnTo: "/dashboard/cloudflare" });
		const [, init] = fetchMock.mock.calls[0]!;
		expect(init.headers.Authorization).toBe(`Basic ${btoa("client-id:client-secret")}`);
		expect(String(init.body)).toContain("code_verifier=");
		const row = sqlite.prepare("SELECT * FROM cloudflare_connections WHERE user_id = 'u1'").get() as Record<string, string>;
		expect(row.access_token_enc).not.toContain("access-1");
		expect(String(fetchMock.mock.calls[1]![0])).toBe("https://api.cloudflare.com/client/v4/user");
		expect(row.cf_email).toBe("buyer@example.test");
		expect(await oauth.accessToken("u1")).toBe("access-1");
	});

	it("uses each state once, only for the user who started it, and only for 10 minutes", async () => {
		const url = new URL(await oauth.authorizationUrl("u1", "/x"));
		const state = url.searchParams.get("state")!;
		expect(await oauth.completeAuthorization("u2", state, "c")).toEqual({ ok: false, reason: "wrong_user" });
		expect(await oauth.completeAuthorization("u1", state, "c")).toEqual({ ok: false, reason: "invalid_state" });
		const old = new URL(await oauth.authorizationUrl("u1", "/x")).searchParams.get("state")!;
		sqlite.prepare("UPDATE cloudflare_oauth_states SET created_at = '2000-01-01T00:00:00Z' WHERE state = ?").run(old);
		expect(await oauth.completeAuthorization("u1", old, "c")).toEqual({ ok: false, reason: "invalid_state" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refreshes an access token that is about to expire", async () => {
		await connect();
		sqlite.prepare("UPDATE cloudflare_connections SET expires_at = ? WHERE user_id = 'u1'").run(new Date(Date.now() + 30_000).toISOString());
		fetchMock.mockResolvedValueOnce(tokenReply("access-2", "refresh-2"));
		expect(await oauth.accessToken("u1")).toBe("access-2");
		expect(String(fetchMock.mock.calls.at(-1)![1].body)).toContain("grant_type=refresh_token");
		expect(await oauth.accessToken("u1")).toBe("access-2");
	});

	it("revokes at Cloudflare and deletes on disconnect", async () => {
		await connect();
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
		await oauth.disconnect("u1");
		const revokes = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/oauth2/revoke"));
		expect(revokes).toHaveLength(2);
		expect((await oauth.connection("u1")).connected).toBe(false);
		expect(await oauth.accessToken("u1")).toBeNull();
	});
});
