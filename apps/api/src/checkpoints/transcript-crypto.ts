/** #129: per-account transcript encryption (no Workers imports, so it is unit-testable). */
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function accountKey(master: string, ownerId: string): Promise<CryptoKey> {
	const raw = unb64(master);
	if (raw.length !== 32) throw new Error("TRANSCRIPT_KEY must be 32 bytes, base64-encoded");
	const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("appmarket-transcripts-v1"), info: new TextEncoder().encode(ownerId) },
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function seal(master: string, ownerId: string, aad: string, plain: Uint8Array): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, await accountKey(master, ownerId), plain));
	const out = new Uint8Array(iv.length + sealed.length);
	out.set(iv);
	out.set(sealed, iv.length);
	return out;
}

export async function open(master: string, ownerId: string, aad: string, data: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12), additionalData: new TextEncoder().encode(aad) }, await accountKey(master, ownerId), data.subarray(12)));
}
