/**
 * #230: signed one-click unsubscribe links (RFC 8058). The signature is an HMAC of the user and the
 * topic with a key derived from the auth secret, so a link works without signing in and cannot be
 * forged for another user.
 */
export const EMAIL_TOPICS = ["impacts", "pulls", "issues"] as const;
export type EmailTopic = (typeof EMAIL_TOPICS)[number];

async function key(secret: string): Promise<CryptoKey> {
	const material = new TextEncoder().encode(`appmarket.email-unsubscribe.v1:${secret}`);
	const digest = await crypto.subtle.digest("SHA-256", material);
	return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signUnsubscribe(secret: string, userId: string, topic: EmailTopic): Promise<string> {
	return b64url(await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(`${userId}:${topic}`)));
}

export async function verifyUnsubscribe(secret: string, userId: string, topic: string, signature: string): Promise<boolean> {
	if (!(EMAIL_TOPICS as readonly string[]).includes(topic) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
	const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0));
	return crypto.subtle.verify("HMAC", await key(secret), bytes, new TextEncoder().encode(`${userId}:${topic}`));
}

/** The query string of an unsubscribe link. */
export async function unsubscribeQuery(secret: string, userId: string, topic: EmailTopic): Promise<string> {
	return new URLSearchParams({ u: userId, t: topic, s: await signUnsubscribe(secret, userId, topic) }).toString();
}
