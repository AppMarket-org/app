/** PRD D5: OAuth scopes appmarket.org requests to deploy into a buyer's Cloudflare account. */
export const CF_OAUTH_SCOPES = {
	required: [
		"offline_access",
		"user-details.read",
		"account-settings.read",
		"memberships.read",
		"workers-scripts.write",
		"d1.write",
		"workers-kv-storage.write",
		"workers-r2.write",
	],
	optional: ["queues.write", "vectorize.write", "query-cache.write", "containers.write", "workers-observability.read"],
} as const;

export interface CloudflareConnection {
	connected: boolean;
	email: string | null;
	scopes: string[];
	connectedAt: string | null;
}

export interface CloudflareAccount {
	id: string;
	name: string;
}
