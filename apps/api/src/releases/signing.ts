/**
 * PRD R14: download links are signed with HMAC-SHA256 over "<releaseId>.<expiresAtSeconds>".
 * Verification uses crypto.subtle.verify, which compares in constant time.
 */
async function key(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);

export async function signDownload(secret: string, releaseId: string, expiresAt: number): Promise<string> {
	return toHex(await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(`${releaseId}.${expiresAt}`)));
}

/** True only for an unexpired link whose signature matches. */
export async function verifyDownload(secret: string, releaseId: string, expiresAt: number, signature: string, now = Date.now()): Promise<boolean> {
	if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 < now) return false;
	if (!/^[0-9a-f]{64}$/.test(signature)) return false;
	return crypto.subtle.verify("HMAC", await key(secret), fromHex(signature), new TextEncoder().encode(`${releaseId}.${expiresAt}`));
}
