// PRD R4: one Artifacts namespace (and Worker name) per environment, selected by `cf --mode`.
// `cf dev` uses "development", builds default to "production"; API commands leave the mode undefined.

export const ENVIRONMENTS = {
	development: {
		workerName: "appmarket-api-dev",
		artifactsNamespace: "dev",
		// Local-only ID: dev never touches a remote D1 database. Keep in sync with scripts/local-d1.json.
		database: { name: "appmarket-dev", id: "37a21f9c-7f7d-4ea2-a13d-8a3dcc58c931" },
		// Browser origin; `ng serve` proxies /api here, so auth cookies and OAuth callbacks use it.
		publicOrigin: "http://localhost:4200",
		// R20: rate limiter namespace ids are account-wide; each environment gets its own block.
		rateLimitBase: 1100,
	},
	staging: {
		workerName: "appmarket-api-staging",
		artifactsNamespace: "staging",
		// IDs are filled in when the remote databases are created (R22, #24).
		database: { name: "appmarket-staging", id: undefined },
		publicOrigin: "https://staging.appmarket.org",
		rateLimitBase: 1200,
	},
	production: {
		workerName: "appmarket-api",
		artifactsNamespace: "prod",
		database: { name: "appmarket-prod", id: undefined },
		publicOrigin: "https://appmarket.org",
		rateLimitBase: 1300,
	},
} as const;

export type AppEnvironment = keyof typeof ENVIRONMENTS;

export function resolveEnvironment(mode: string | undefined): AppEnvironment {
	const name = mode ?? "development";
	if (!(name in ENVIRONMENTS)) {
		throw new Error(`Unknown mode "${name}". Use one of: ${Object.keys(ENVIRONMENTS).join(", ")}.`);
	}
	return name as AppEnvironment;
}

/** PRD R20 limits. Workers rate limits count per Cloudflare location, so they are approximate. */
export const RATE_LIMITS = {
	/** Per signed-in user. */
	TOKENS: { offset: 1, limit: 20, period: 60 },
	/** Per signed-in user. */
	LISTING_CREATE: { offset: 2, limit: 5, period: 60 },
	/** Per client IP (no user yet); Turnstile is the main defence. */
	SIGN_IN: { offset: 3, limit: 10, period: 60 },
} as const;
