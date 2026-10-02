import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env: Record<string, unknown> = {};
vi.mock("cloudflare:workers", () => ({ env }));
const { requireAccess, verifyAccessJwt } = await import("./access.ts");

const TEAM = "appmarket.cloudflareaccess.com";
const AUD = "aud-123";
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

async function sign(payload: Record<string, unknown>, kid = "k1", key = keys.privateKey): Promise<string> {
	const head = `${json({ alg: "RS256", kid })}.${json(payload)}`;
	const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head)));
	return `${head}.${b64url(sig)}`;
}

const now = Date.now();
const claims = { iss: `https://${TEAM}`, aud: [AUD], exp: Math.floor(now / 1000) + 300, email: "admin@example.test" };

beforeAll(async () => {
	keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	publicJwk = { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid: "k1" };
});

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }))));
});

describe("verifyAccessJwt", () => {
	it("accepts a token signed by the team with the right audience", async () => {
		expect(await verifyAccessJwt(await sign(claims), TEAM, AUD, now)).toBe(true);
	});

	it("rejects wrong audience, issuer, expiry, key or tampering", async () => {
		expect(await verifyAccessJwt(await sign({ ...claims, aud: ["other"] }), TEAM, AUD, now)).toBe(false);
		expect(await verifyAccessJwt(await sign({ ...claims, iss: "https://evil.cloudflareaccess.com" }), TEAM, AUD, now)).toBe(false);
		expect(await verifyAccessJwt(await sign({ ...claims, exp: Math.floor(now / 1000) - 1 }), TEAM, AUD, now)).toBe(false);
		expect(await verifyAccessJwt(await sign(claims, "unknown"), TEAM, AUD, now)).toBe(false);
		const other = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"])) as CryptoKeyPair;
		expect(await verifyAccessJwt(await sign(claims, "k1", other.privateKey), TEAM, AUD, now)).toBe(false);
		const [h, , s] = (await sign(claims)).split(".");
		expect(await verifyAccessJwt(`${h}.${json({ ...claims, email: "x@y" })}.${s}`, TEAM, AUD, now)).toBe(false);
		expect(await verifyAccessJwt("not-a-jwt", TEAM, AUD, now)).toBe(false);
	});
});

describe("requireAccess", () => {
	const app = new Hono().use(requireAccess()).get("/", (c) => c.text("ok"));

	it("is skipped in development", async () => {
		Object.assign(env, { APP_ENV: "development", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
		expect((await app.request("/")).status).toBe(200);
	});

	it("fails closed when a deployed environment has no Access settings", async () => {
		Object.assign(env, { APP_ENV: "staging", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
		expect((await app.request("/")).status).toBe(503);
	});

	it("requires a valid Access token when configured", async () => {
		Object.assign(env, { APP_ENV: "staging", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
		expect((await app.request("/")).status).toBe(403);
		expect((await app.request("/", { headers: { "cf-access-jwt-assertion": await sign(claims) } })).status).toBe(200);
	});
});
