import type { WorkerDomain } from "@appmarket/shared";
import { CloudflareApiError, call } from "./versions.ts";

/**
 * #39 (D9): Workers Custom Domains in the buyer's account (workers-scripts.write). Cloudflare
 * creates the DNS record and certificate. If a connection cannot list zones, the buyer types the
 * hostname instead; it is enough to attach.
 */
const acct = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

export async function listZones(fetcher: typeof fetch, token: string, accountId: string): Promise<{ id: string; name: string }[] | null> {
	try {
		const zones = await call<{ id: string; name: string }[]>(fetcher, token, `/zones?account.id=${encodeURIComponent(accountId)}&status=active&per_page=50`);
		return zones.map((z) => ({ id: z.id, name: z.name })).sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		// This connection cannot list zones: the picker is skipped.
		if (error instanceof CloudflareApiError && (error.status === 403 || error.status === 401)) return null;
		throw error;
	}
}

export async function listDomains(fetcher: typeof fetch, token: string, accountId: string, worker: string): Promise<WorkerDomain[]> {
	const items = await call<{ id: string; hostname: string; zone_name?: string; service: string }[]>(fetcher, token, `${acct(accountId)}/workers/domains?service=${encodeURIComponent(worker)}`);
	return items.filter((d) => d.service === worker).map((d) => ({ id: d.id, hostname: d.hostname, zoneName: d.zone_name ?? null }));
}

export async function attachDomain(fetcher: typeof fetch, token: string, accountId: string, worker: string, hostname: string, zoneId?: string): Promise<WorkerDomain> {
	const d = await call<{ id: string; hostname: string; zone_name?: string }>(fetcher, token, `${acct(accountId)}/workers/domains`, {
		method: "PUT",
		body: JSON.stringify({ hostname, service: worker, environment: "production", ...(zoneId ? { zone_id: zoneId } : {}) }),
	});
	return { id: d.id, hostname: d.hostname, zoneName: d.zone_name ?? null };
}

export async function detachDomain(fetcher: typeof fetch, token: string, accountId: string, domainId: string): Promise<void> {
	await call(fetcher, token, `${acct(accountId)}/workers/domains/${encodeURIComponent(domainId)}`, { method: "DELETE" });
}

/** What to tell the buyer when Cloudflare refuses an attach. */
export function domainErrorMessage(error: CloudflareApiError, hostname: string): string {
	const m = error.message.toLowerCase();
	if (/already has externally managed dns|existing (dns )?record|cname/.test(m)) return `${hostname} already has a DNS record (for example a CNAME). Delete it in the Cloudflare dashboard, then try again.`;
	if (/zone.*(not found|could not be found|does not exist)|no zone|not a valid zone|could not find.*zone/.test(m)) {
		return `${hostname} is not on a Cloudflare zone in this account. Add the domain to Cloudflare and change its nameservers at your registrar, wait until the zone is active, then try again.`;
	}
	if (/already (exists|in use|attached)|in use by another/.test(m)) return `${hostname} is already attached to another Worker.`;
	return `Cloudflare said: ${error.message}`;
}
