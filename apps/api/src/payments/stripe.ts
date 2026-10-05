/**
 * #42 (R17): a minimal Stripe API client over fetch (form-encoded, like Stripe's own SDKs) and
 * webhook signature checks. Pure apart from fetch; unit-tested.
 */
const API = "https://api.stripe.com/v1";

export class StripeError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
	}
}

/** True for a real key; deploys without one get a placeholder and payments stay off. */
export const stripeConfigured = (key: string | undefined): key is string => !!key && /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key);

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0]=v. */
export function encode(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		const name = prefix ? `${prefix}[${key}]` : key;
		if (Array.isArray(value)) value.forEach((v, i) => (typeof v === "object" && v !== null ? encode(v as Params, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(v))));
		else if (typeof value === "object") encode(value as Params, name, out);
		else out.append(name, String(value));
	}
	return out;
}

export async function stripe<T>(key: string, method: "GET" | "POST" | "DELETE", path: string, params?: Params, opts: { idempotencyKey?: string; fetcher?: typeof fetch } = {}): Promise<T> {
	const body = params ? encode(params) : undefined;
	const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
	const response = await (opts.fetcher ?? fetch)(url, {
		method,
		headers: {
			Authorization: `Bearer ${key}`,
			"Stripe-Version": "2025-09-30.clover",
			...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
			...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
		},
		body: method === "GET" ? undefined : body,
	});
	const data = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
	if (!response.ok || !data) throw new StripeError(response.status, data?.error?.code, data?.error?.message ?? `Stripe HTTP ${response.status}`);
	return data;
}

async function hmacHex(secret: string, text: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stripe-Signature: t=<unix>,v1=<hmac of "t.payload">; within 5 minutes, constant-time compare. */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
	if (!header) return false;
	const parts = header.split(",").map((p) => p.split("=") as [string, string]);
	const t = Number(parts.find(([k]) => k === "t")?.[1]);
	if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
	const expected = await hmacHex(secret, `${t}.${payload}`);
	return parts.some(([k, v]) => {
		if (k !== "v1" || !v || v.length !== expected.length) return false;
		let diff = 0;
		for (let i = 0; i < v.length; i++) diff |= v.charCodeAt(i) ^ expected.charCodeAt(i);
		return diff === 0;
	});
}

export const signForTest = async (payload: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
