/**
 * #34: push webhooks. Artifacts sends no push events, so the minute cron compares each watched
 * repo's refs and delivers one event per moved branch or tag. Pure helpers, unit-tested.
 */
export type WebhookFormat = "generic" | "github";

export interface RefChange {
	ref: string;
	/** null for a new branch or tag. */
	before: string | null;
	after: string;
}

/** New or moved refs (deletions are not delivered). */
export function changedRefs(previous: Record<string, string>, current: Record<string, string>): RefChange[] {
	return Object.entries(current)
		.filter(([ref, sha]) => previous[ref] !== sha)
		.map(([ref, after]) => ({ ref, before: previous[ref] ?? null, after }))
		.sort((a, b) => a.ref.localeCompare(b.ref));
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** HTTPS to a public host only; never an IP literal in a private range or appmarket.org itself. */
export function webhookUrlProblem(raw: string, format: WebhookFormat): string | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return "Not a valid URL.";
	}
	if (url.protocol !== "https:") return "Use an https:// URL.";
	if (url.username || url.password) return "Put credentials in the secret header, not in the URL.";
	const host = url.hostname.toLowerCase();
	if (PRIVATE_HOST.test(host) || host.startsWith("[") || /(^|\.)appmarket\.org$/.test(host)) return "That host cannot receive webhooks.";
	const ip = IPV4.exec(host);
	if (ip) {
		const [a, b] = [Number(ip[1]), Number(ip[2])];
		if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "That host cannot receive webhooks.";
	}
	if (format === "github" && !/^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/?$/.test(raw)) return "Use the GitHub repository address, like https://github.com/owner/repo.";
	return null;
}

export interface PushEvent {
	event: "push";
	deliveryId: string;
	/** owner/slug on appmarket.org. */
	repo: string;
	ref: string;
	before: string | null;
	after: string;
	/** Git remote; clone with the read token below (valid for an hour). */
	remote: string;
	token: string;
	tokenExpiresAt: string;
	sentAt: string;
}

export async function hmacHex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
	return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The HTTP request for one delivery. Generic: signed JSON. GitHub: a repository_dispatch event. */
export async function deliveryRequest(format: WebhookFormat, url: string, event: PushEvent, secrets: { signing: string; github?: string }): Promise<Request> {
	if (format === "github") {
		const [, owner, repo] = new URL(url).pathname.replace(/\/$/, "").split("/");
		return new Request(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
			method: "POST",
			headers: { Authorization: `Bearer ${secrets.github}`, Accept: "application/vnd.github+json", "User-Agent": "appmarket.org-webhooks", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
			// client_payload allows at most 10 top-level keys; PushEvent has exactly 10.
			body: JSON.stringify({ event_type: "appmarket-push", client_payload: event }),
		});
	}
	const body = JSON.stringify(event);
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", "User-Agent": "appmarket.org-webhooks", "X-Appmarket-Event": "push", "X-Appmarket-Delivery": event.deliveryId, "X-Appmarket-Signature-256": `sha256=${await hmacHex(secrets.signing, body)}` },
		body,
	});
}
