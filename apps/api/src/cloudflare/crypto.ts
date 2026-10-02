/**
 * PRD D5: buyer OAuth tokens are encrypted at rest with AES-256-GCM. The key is a Worker secret
 * (base64, 32 bytes); the user id is bound as additional data so a token copied to another user's
 * row does not decrypt.
 */
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function importKey(secret: string): Promise<CryptoKey> {
	const raw = unb64(secret);
	if (raw.length !== 32) throw new Error("CF_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(secret: string, plaintext: string, userId: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await importKey(secret), new TextEncoder().encode(plaintext));
	return `v1.${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}

export async function decryptToken(secret: string, sealed: string, userId: string): Promise<string> {
	const [version, iv, data] = sealed.split(".");
	if (version !== "v1" || !iv || !data) throw new Error("Unknown token format");
	const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, await importKey(secret), unb64(data));
	return new TextDecoder().decode(plain);
}

/** PKCE (RFC 7636): random verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	return { verifier, challenge: b64url(digest) };
}

export function randomState(): string {
	return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

function b64url(bytes: Uint8Array): string {
	return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
