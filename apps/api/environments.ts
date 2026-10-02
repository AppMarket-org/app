// PRD R4: one Artifacts namespace (and Worker name) per environment, selected by `cf --mode`.
// `cf dev` uses "development", builds default to "production"; API commands leave the mode undefined.

export const ENVIRONMENTS = {
	development: { workerName: "appmarket-api-dev", artifactsNamespace: "dev" },
	staging: { workerName: "appmarket-api-staging", artifactsNamespace: "staging" },
	production: { workerName: "appmarket-api", artifactsNamespace: "prod" },
} as const;

export type AppEnvironment = keyof typeof ENVIRONMENTS;

export function resolveEnvironment(mode: string | undefined): AppEnvironment {
	const name = mode ?? "development";
	if (!(name in ENVIRONMENTS)) {
		throw new Error(`Unknown mode "${name}". Use one of: ${Object.keys(ENVIRONMENTS).join(", ")}.`);
	}
	return name as AppEnvironment;
}
