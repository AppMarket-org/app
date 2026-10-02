import { env } from "cloudflare:workers";
import type { MiddlewareHandler } from "hono";

/**
 * PRD R18/R22: /api/admin also sits behind Cloudflare Access. Access puts a signed JWT on every
 * request it lets through; this checks it, so the admin API stays closed even if the Access
 * application is misconfigured or a request reaches the Worker another way. Development skips it;
 * deployed environments without ACCESS_TEAM_DOMAIN/ACCESS_AUD refuse admin requests.
 */
export function requireAccess(): MiddlewareHandler {
	return async (c, next) => {
		if (env.APP_ENV === "development") return next();
		const teamDomain = env.ACCESS_TEAM_DOMAIN;
		const aud = env.ACCESS_AUD;
		if (!teamDomain || !aud) return c.json({ error: "access_not_configured" }, 503);
		const token = c.req.header("cf-access-jwt-assertion");
		if (!token || !(await verifyAccessJwt(token, teamDomain, aud))) return c.json({ error: "access_required" }, 403);
		await next();
	};
}

interface Jwk extends JsonWebKey {
	kid?: string;
}

const CERTS_TTL_MS = 60 * 60 * 1000;
let certs: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function signingKeys(teamDomain: string, refresh = false): Promise<Jwk[]> {
	if (!refresh && certs?.teamDomain === teamDomain && Date.now() - certs.fetchedAt < CERTS_TTL_MS) return certs.keys;
	const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!response.ok) return certs?.teamDomain === teamDomain ? certs.keys : [];
	const { keys } = (await response.json()) as { keys: Jwk[] };
	certs = { teamDomain, keys, fetchedAt: Date.now() };
	return keys;
}

const b64url = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

/** RS256 Access token: signature from the team's certs, issuer, audience and expiry. */
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string, now = Date.now()): Promise<boolean> {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	const [h, p, s] = parts as [string, string, string];
	let header: { alg?: string; kid?: string };
	let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number };
	try {
		header = JSON.parse(new TextDecoder().decode(b64url(h)));
		payload = JSON.parse(new TextDecoder().decode(b64url(p)));
	} catch {
		return false;
	}
	if (header.alg !== "RS256" || !header.kid) return false;
	let jwk = (await signingKeys(teamDomain)).find((k) => k.kid === header.kid);
	// Access rotates keys; refetch once for an unknown kid.
	if (!jwk) jwk = (await signingKeys(teamDomain, true)).find((k) => k.kid === header.kid);
	if (!jwk) return false;
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
	if (!valid) return false;
	const seconds = now / 1000;
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	return payload.iss === `https://${teamDomain}` && audiences.includes(aud) && typeof payload.exp === "number" && payload.exp > seconds && (payload.nbf === undefined || payload.nbf <= seconds + 60);
}
