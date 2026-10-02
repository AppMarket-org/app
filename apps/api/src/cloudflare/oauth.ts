import { CF_OAUTH_SCOPES, type CloudflareConnection } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { decryptToken, encryptToken, pkcePair, randomState } from "./crypto.ts";

const AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";
/** userinfo only returns `sub`; the email comes from the user API (user-details.read). */
const USER_URL = "https://api.cloudflare.com/client/v4/user";
const STATE_TTL_MINUTES = 10;

const redirectUri = () => `${env.PUBLIC_ORIGIN}/api/cloudflare/callback`;
const basicAuth = () => `Basic ${btoa(`${env.CF_OAUTH_CLIENT_ID}:${env.CF_OAUTH_CLIENT_SECRET}`)}`;

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
}

/** PRD D5: starts the Authorization Code flow (client secret + PKCE + one-time state). */
export async function authorizationUrl(userId: string, returnTo: string): Promise<string> {
	const state = randomState();
	const { verifier, challenge } = await pkcePair();
	await env.DB.batch([
		env.DB.prepare(`DELETE FROM cloudflare_oauth_states WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${STATE_TTL_MINUTES} minutes')`),
		env.DB.prepare("INSERT INTO cloudflare_oauth_states (state, user_id, code_verifier, return_to) VALUES (?, ?, ?, ?)").bind(state, userId, verifier, returnTo),
	]);
	const url = new URL(AUTHORIZE_URL);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: env.CF_OAUTH_CLIENT_ID,
		redirect_uri: redirectUri(),
		scope: [...CF_OAUTH_SCOPES.required, ...CF_OAUTH_SCOPES.optional].join(" "),
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}

export type CallbackResult = { ok: true; returnTo: string } | { ok: false; reason: "invalid_state" | "wrong_user" | "exchange_failed" };

/** Validates state (one use, 10 minutes, same appmarket user), exchanges the code and stores the tokens. */
export async function completeAuthorization(userId: string, state: string, code: string): Promise<CallbackResult> {
	const row = await env.DB.prepare(
		`DELETE FROM cloudflare_oauth_states WHERE state = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${STATE_TTL_MINUTES} minutes') RETURNING user_id, code_verifier, return_to`,
	)
		.bind(state)
		.first<{ user_id: string; code_verifier: string; return_to: string }>();
	if (!row) return { ok: false, reason: "invalid_state" };
	if (row.user_id !== userId) return { ok: false, reason: "wrong_user" };

	const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: row.code_verifier });
	if (!tokens) return { ok: false, reason: "exchange_failed" };
	const email = await fetch(USER_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
		.then((r) => (r.ok ? (r.json() as Promise<{ result?: { email?: string } }>) : {}))
		.then((u) => (u as { result?: { email?: string } }).result?.email ?? null)
		.catch(() => null);
	await saveTokens(userId, tokens, email);
	return { ok: true, returnTo: row.return_to };
}

/** A valid access token for the user's connection, refreshed when it expires within a minute. */
export async function accessToken(userId: string): Promise<string | null> {
	const row = await env.DB.prepare("SELECT access_token_enc, refresh_token_enc, expires_at FROM cloudflare_connections WHERE user_id = ?")
		.bind(userId)
		.first<{ access_token_enc: string; refresh_token_enc: string | null; expires_at: string }>();
	if (!row) return null;
	if (Date.parse(row.expires_at) - Date.now() > 60_000) return decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, row.access_token_enc, userId);
	if (!row.refresh_token_enc) return null;
	const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, row.refresh_token_enc, userId) });
	if (!refreshed) return null;
	await saveTokens(userId, refreshed, undefined);
	return refreshed.access_token;
}

export async function connection(userId: string): Promise<CloudflareConnection> {
	const row = await env.DB.prepare("SELECT cf_email, scopes, created_at FROM cloudflare_connections WHERE user_id = ?").bind(userId).first<{ cf_email: string | null; scopes: string; created_at: string }>();
	return row ? { connected: true, email: row.cf_email, scopes: row.scopes.split(" ").filter(Boolean), connectedAt: row.created_at } : { connected: false, email: null, scopes: [], connectedAt: null };
}

/** PRD D5: disconnect revokes the tokens at Cloudflare (best effort) and deletes them. */
export async function disconnect(userId: string): Promise<void> {
	const row = await env.DB.prepare("SELECT access_token_enc, refresh_token_enc FROM cloudflare_connections WHERE user_id = ?").bind(userId).first<{ access_token_enc: string; refresh_token_enc: string | null }>();
	if (!row) return;
	const revoke = async (sealed: string | null, hint: string) => {
		if (!sealed) return;
		const token = await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, sealed, userId).catch(() => null);
		if (!token) return;
		await fetch(REVOKE_URL, { method: "POST", headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, token_type_hint: hint }) }).catch(() => undefined);
	};
	await Promise.all([revoke(row.refresh_token_enc, "refresh_token"), revoke(row.access_token_enc, "access_token")]);
	await env.DB.prepare("DELETE FROM cloudflare_connections WHERE user_id = ?").bind(userId).run();
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse | null> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams(params),
	});
	if (!response.ok) {
		console.warn("cloudflare oauth token request failed", response.status);
		return null;
	}
	return response.json() as Promise<TokenResponse>;
}

async function saveTokens(userId: string, tokens: TokenResponse, email: string | null | undefined): Promise<void> {
	const key = env.CF_TOKEN_ENCRYPTION_KEY;
	const access = await encryptToken(key, tokens.access_token, userId);
	const refresh = tokens.refresh_token ? await encryptToken(key, tokens.refresh_token, userId) : null;
	const expires = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
	await env.DB.prepare(
		`INSERT INTO cloudflare_connections (user_id, cf_email, access_token_enc, refresh_token_enc, expires_at, scopes)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (user_id) DO UPDATE SET
		   cf_email = COALESCE(excluded.cf_email, cf_email),
		   access_token_enc = excluded.access_token_enc,
		   refresh_token_enc = COALESCE(excluded.refresh_token_enc, refresh_token_enc),
		   expires_at = excluded.expires_at,
		   scopes = COALESCE(NULLIF(excluded.scopes, ''), scopes),
		   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
	)
		.bind(userId, email ?? null, access, refresh, expires, tokens.scope ?? "")
		.run();
}
