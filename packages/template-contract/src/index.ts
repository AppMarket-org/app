// Submit-time template contract lint (PRD D2) and deploy manifest (D3).
// A deployable app ships a Wrangler config with default resource names, env vars in wrangler.json,
// secrets listed in .dev.vars.example and build scripts in package.json.

export interface ContractIssue {
  file: string;
  message: string;
}

export interface DeployManifest {
  resources: { type: string; name: string }[];
  envVars: string[];
  secrets: string[];
}

export function validateTemplate(_files: Map<string, string>): ContractIssue[] {
  throw new Error("Not implemented: see issue for PRD D2");
}

export function readDeployManifest(_files: Map<string, string>): DeployManifest {
  throw new Error("Not implemented: see issue for PRD D3");
}
