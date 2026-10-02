// PRD R4: one Artifacts namespace (and Worker name) per environment, selected by `cf --mode`.
// `cf dev` uses "development", builds default to "production"; API commands leave the mode undefined.

export const ENVIRONMENTS = {
	development: {
		workerName: "appmarket-api-dev",
		artifactsNamespace: "dev",
		// Local-only ID: dev never touches a remote D1 database.
		database: { name: "appmarket-dev", id: "37a21f9c-7f7d-4ea2-a13d-8a3dcc58c931" },
		// Browser origin; `ng serve` proxies /api here, so auth cookies and OAuth callbacks use it.
		publicOrigin: "http://localhost:4200",
	},
	staging: {
		workerName: "appmarket-api-staging",
		artifactsNamespace: "staging",
		// IDs are filled in when the remote databases are created (R22, #24).
		database: { name: "appmarket-staging", id: undefined },
		publicOrigin: "https://staging.appmarket.org",
	},
	production: {
		workerName: "appmarket-api",
		artifactsNamespace: "prod",
		database: { name: "appmarket-prod", id: undefined },
		publicOrigin: "https://appmarket.org",
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
