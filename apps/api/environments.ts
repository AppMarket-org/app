/** appmarket.org's own Cloudflare account: Artifacts repos and deploy builds (D6) live here. */
export const CLOUDFLARE_ACCOUNT_ID = "aada0f21d612f647ef27d21e1c09b648";

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
		// R2 bucket for screenshots (R24); local simulation in dev.
		mediaBucket: "appmarket-media-dev",
		// R13 release binaries.
		releasesBucket: "appmarket-releases-dev",
		// D6 build workspace snapshots between Workflow steps.
		buildsBucket: "appmarket-builds-dev",
		// R22: Cloudflare Access on /admin. Not used in development.
		access: { teamDomain: "", aud: "" },
	},
	staging: {
		workerName: "appmarket-api-staging",
		artifactsNamespace: "staging",
		database: { name: "appmarket-staging", id: "7bbb371d-dc0a-4b67-92ed-74dd2e5c4363" },
		publicOrigin: "https://staging.appmarket.org",
		rateLimitBase: 1200,
		mediaBucket: "appmarket-media-staging",
		// R13 release binaries.
		releasesBucket: "appmarket-releases-staging",
		// D6 build workspace snapshots between Workflow steps.
		buildsBucket: "appmarket-builds-staging",
		// R22: Cloudflare Access team domain and the /admin application's AUD tag (both public).
		// Until set, the deployed API refuses /api/admin (see docs/deploy-runbook.md).
		access: { teamDomain: "cportsche1.cloudflareaccess.com", aud: "09de5142e7a6247d4dba8782ed8ed5cd0451e1a065e8cde05f07e2934ff0919c" },
	},
	production: {
		workerName: "appmarket-api",
		artifactsNamespace: "prod",
		database: { name: "appmarket-prod", id: "4c4a9a0e-de78-497b-a7ef-11efab9f62f3" },
		publicOrigin: "https://appmarket.org",
		rateLimitBase: 1300,
		mediaBucket: "appmarket-media-prod",
		// R13 release binaries.
		releasesBucket: "appmarket-releases-prod",
		// D6 build workspace snapshots between Workflow steps.
		buildsBucket: "appmarket-builds-prod",
		// R22: Cloudflare Access team domain and the /admin application's AUD tag (both public).
		// Until set, the deployed API refuses /api/admin (see docs/deploy-runbook.md).
		access: { teamDomain: "cportsche1.cloudflareaccess.com", aud: "89058f739ae9e219a89f42fd868b501fb80d6a62a8b4dff41aff407fdb771d8b" },
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
	REPO_CREATE: { offset: 2, limit: 5, period: 60 },
	/** Per client IP (no user yet); Turnstile is the main defence. */
	SIGN_IN: { offset: 3, limit: 10, period: 60 },
	/** Download links, per signed-in user or client IP (R14). */
	DOWNLOAD_LINK: { offset: 4, limit: 30, period: 60 },
	/** Repo reports, per signed-in user or client IP (R18). */
	REPORT: { offset: 5, limit: 5, period: 60 },
	/** One-click deploys, per signed-in user (D6); each runs a build container. */
	DEPLOY: { offset: 6, limit: 3, period: 60 },
	/** Checkpoint uploads, per device session (Checkpoints PRD: 60/min per device). */
	CHECKPOINT: { offset: 7, limit: 60, period: 60 },
} as const;
