/** PRD D3: what deploying a listing creates in the buyer's Cloudflare account. */
export type ManifestResourceType =
	| "kv"
	| "d1"
	| "r2"
	| "queue"
	| "durable-object"
	| "vectorize"
	| "hyperdrive"
	| "workers-ai"
	| "workflow"
	| "service"
	| "analytics-engine"
	| "browser"
	| "images"
	| "container"
	| "assets";

export interface DeployManifest {
	resources: { type: ManifestResourceType; binding: string; name: string | null }[];
	/** Plain environment variable names from the Wrangler config. */
	envVars: string[];
	/** Secret names from .dev.vars.example or .env.example; buyers set the values. */
	secrets: string[];
}

/** PRD D2/G4: result of the submit-time template check. Errors block submission. */
export interface ContractIssue {
	rule: string;
	file: string;
	message: string;
}

export interface ContractResult {
	errors: ContractIssue[];
	warnings: ContractIssue[];
	manifest: DeployManifest | null;
}
