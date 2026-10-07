import type { WorkerVersion } from "@appmarket/shared";

/**
 * #38 (D8): deploy history and rollback through the Workers versions and deployments API, with
 * the buyer's own OAuth token. Pure: callers pass the token and fetch, so this is unit-tested.
 */
const API = "https://api.cloudflare.com/client/v4";

interface CfVersion {
	id: string;
	number: number;
	metadata?: { created_on?: string; source?: string };
	annotations?: Record<string, string>;
}
interface CfDeployment {
	versions: { version_id: string; percentage: number }[];
}

export class CloudflareApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export async function call<T>(fetcher: typeof fetch, token: string, path: string, init?: RequestInit): Promise<T> {
	const send = () => fetcher(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
	let response = await send();
	// Cloudflare's API sometimes answers a read with a passing 5xx (seen right after a Worker is created); read again once.
	if (response.status >= 500 && (!init?.method || init.method === "GET")) {
		await new Promise((r) => setTimeout(r, 500));
		response = await send();
	}
	const body = (await response.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
	if (!response.ok || !body?.success) throw new CloudflareApiError(response.status, body?.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
	return body.result as T;
}

const script = (accountId: string, worker: string) => `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(worker)}`;

/** The newest versions (up to 20), with the traffic share each serves now. */
export async function workerVersions(fetcher: typeof fetch, token: string, accountId: string, worker: string): Promise<WorkerVersion[]> {
	const [versions, deployments] = await Promise.all([
		call<{ items: CfVersion[] }>(fetcher, token, `${script(accountId, worker)}/versions?per_page=20`),
		call<{ deployments: CfDeployment[] }>(fetcher, token, `${script(accountId, worker)}/deployments`),
	]);
	const live = new Map((deployments.deployments[0]?.versions ?? []).map((v) => [v.version_id, v.percentage]));
	return versions.items
		.map((v) => ({
			id: v.id,
			number: v.number,
			createdAt: v.metadata?.created_on ?? "",
			message: v.annotations?.["workers/message"] ?? null,
			source: v.metadata?.source ?? null,
			percentage: live.get(v.id) ?? 0,
		}))
		.sort((a, b) => b.number - a.number);
}

/** Sends all traffic to one existing version. */
export async function rollbackTo(fetcher: typeof fetch, token: string, accountId: string, worker: string, versionId: string): Promise<void> {
	await call(fetcher, token, `${script(accountId, worker)}/deployments`, {
		method: "POST",
		body: JSON.stringify({ strategy: "percentage", versions: [{ version_id: versionId, percentage: 100 }], annotations: { "workers/message": "Rolled back via appmarket.org" } }),
	});
}
