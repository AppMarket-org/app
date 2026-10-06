/** appmarket.org's own Cloudflare account: Artifacts repos and deploy builds (D6) live here. */
export const CLOUDFLARE_ACCOUNT_ID = "aada0f21d612f647ef27d21e1c09b648";

// R22: the Cloudflare Access team domain and the /admin application's AUD tag come from the deploy's
// GitHub environment variables (ACCESS_TEAM_DOMAIN, ACCESS_AUD), so the public repo doesn't name the
// owner's Zero Trust team. Read when the config loads (cf deploy, preflight); Worker code gets bindings.
const accessFromEnv = () => ({ teamDomain: process.env.ACCESS_TEAM_DOMAIN ?? "", aud: process.env.ACCESS_AUD ?? "" });

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
		// #230: sender for notification email (Cloudflare Email Service). Dev uses the local
		// simulation, which prints messages instead of sending them. Empty = email off.
		emailFrom: "notifications@appmarket.org",
		emailRemote: false,
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
		// R22: Access on /admin. Until set, the deployed API refuses /api/admin (see docs/deploy-runbook.md).
		access: accessFromEnv(),
		// appmarket.org is onboarded in Email Service (Compute > Email Service > Email Sending).
		emailFrom: "notifications@appmarket.org",
		emailRemote: true,
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
		// R22: Access on /admin. Until set, the deployed API refuses /api/admin (see docs/deploy-runbook.md).
		access: accessFromEnv(),
		// #230: same sender as staging; the appmarket.org domain is onboarded to Email Service.
		emailFrom: "notifications@appmarket.org",
		emailRemote: true,
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
	/** #132: device codes, per IP. */
	DEVICE_CODE: { offset: 8, limit: 10, period: 60 },
	/** #194: memory writes, per user (agents write in bursts). */
	MEMORY: { offset: 9, limit: 60, period: 60 },
	/** #256: pull requests opened, per user. */
	PULLS: { offset: 10, limit: 20, period: 60 },
} as const;
