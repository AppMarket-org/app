import { CloudflareApiError, call } from "./versions.ts";

/**
 * #51 (D13): plain variables and secrets of the buyer's deployed Worker, through the Workers
 * settings and secrets APIs with the buyer's token. Every change creates a new version and
 * deploys it. Secret values are passed through and never stored, returned or logged.
 */
interface Binding {
	name: string;
	type: string;
	text?: string;
}

const script = (accountId: string, worker: string) => `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}`;

export async function readConfig(fetcher: typeof fetch, token: string, accountId: string, worker: string): Promise<{ vars: { name: string; value: string }[]; secrets: string[] }> {
	const settings = await call<{ bindings?: Binding[] }>(fetcher, token, `${script(accountId, worker)}/settings`);
	const bindings = settings.bindings ?? [];
	return {
		vars: bindings.filter((b) => b.type === "plain_text").map((b) => ({ name: b.name, value: b.text ?? "" })).sort((a, b) => a.name.localeCompare(b.name)),
		secrets: bindings.filter((b) => b.type === "secret_text").map((b) => b.name).sort(),
	};
}

/**
 * The bindings for a settings PATCH: every existing binding inherited from the latest version,
 * except `name`, which is set to `value` (or dropped when value is null).
 */
export function bindingsWith(existing: Binding[], name: string, value: string | null): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = existing.filter((b) => b.name !== name).map((b) => ({ name: b.name, type: "inherit" }));
	if (value !== null) out.push({ name, type: "plain_text", text: value });
	return out;
}

/** Sets or deletes (value null) a plain variable; Cloudflare creates and deploys a new version. */
export async function writeVar(fetcher: typeof fetch, token: string, accountId: string, worker: string, name: string, value: string | null): Promise<void> {
	const settings = await call<{ bindings?: Binding[] }>(fetcher, token, `${script(accountId, worker)}/settings`);
	const existing = settings.bindings ?? [];
	if (value === null && !existing.some((b) => b.name === name && b.type === "plain_text")) return;
	const form = new FormData();
	form.set("settings", new Blob([JSON.stringify({ bindings: bindingsWith(existing, name, value) })], { type: "application/json" }));
	const response = await fetcher(`https://api.cloudflare.com/client/v4${script(accountId, worker)}/settings`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: form });
	const body = (await response.json().catch(() => null)) as { success?: boolean; errors?: { message: string }[] } | null;
	if (!response.ok || !body?.success) {
		throw new CloudflareApiError(response.status, body?.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
	}
}

export async function writeSecret(fetcher: typeof fetch, token: string, accountId: string, worker: string, name: string, value: string | null): Promise<void> {
	if (value === null) {
		await call(fetcher, token, `${script(accountId, worker)}/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
		return;
	}
	await call(fetcher, token, `${script(accountId, worker)}/secrets`, { method: "PUT", body: JSON.stringify({ name, text: value, type: "secret_text" }) });
}
