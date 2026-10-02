// PRD D2 (template contract), G4 (context pack) and D3 (deploy manifest). Pure functions over the
// files of one submitted commit, so the API can run them at submit and publish time.
import type { ContractIssue, ContractResult, DeployManifest, ManifestResourceType, Runtime } from "@appmarket/shared";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

export { buildRepoMap, type RepoMapInput } from "./repo-map";

/** Files the contract reads, by path relative to the repo root. */
export const CONTRACT_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml", "package.json", ".dev.vars.example", ".env.example", "AGENTS.md"] as const;

/** Committed files that usually hold real secrets. */
const SECRET_FILES = [/^\.dev\.vars$/, /^\.dev\.vars\.(?!example$)/, /^\.env$/, /^\.env\.(?!example$)/];
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY|CLIENT_SECRET)$/i;
const MIN_AGENTS_MD = 50;

type Config = Record<string, unknown>;
type Binding = Record<string, unknown>;

export interface TemplateInput {
	runtime: Runtime;
	/** Names of files and directories at the repo root. */
	rootEntries: string[];
	/** Contents of CONTRACT_FILES that exist. */
	files: Map<string, string>;
}

export function checkTemplate({ runtime, rootEntries, files }: TemplateInput): ContractResult {
	const errors: ContractIssue[] = [];
	const warnings: ContractIssue[] = [];
	const error = (rule: string, file: string, message: string) => errors.push({ rule, file, message });
	const warn = (rule: string, file: string, message: string) => warnings.push({ rule, file, message });

	// G4: every listing ships orientation for agents.
	const agents = files.get("AGENTS.md")?.replace(/\s+/g, "") ?? "";
	if (agents.length < MIN_AGENTS_MD) {
		error("agents-md", "AGENTS.md", "Add an AGENTS.md at the repo root that tells an AI agent what the app does, how it is laid out and how to run and test it.");
	}

	for (const name of rootEntries) {
		if (SECRET_FILES.some((p) => p.test(name))) {
			error("no-committed-secrets", name, `${name} usually holds real secrets. Remove it from the repository (and rotate anything it contained); list secret names in .dev.vars.example instead.`);
		}
	}

	const wrangler = readWrangler(files);
	if (!wrangler) {
		if (runtime !== "static") error("wrangler-config", "wrangler.jsonc", "Add a Wrangler config (wrangler.jsonc, wrangler.json or wrangler.toml) at the repo root.");
		return { errors, warnings, manifest: null };
	}
	if ("error" in wrangler) {
		error("wrangler-config", wrangler.path, `${wrangler.path} could not be parsed: ${wrangler.error}`);
		return { errors, warnings, manifest: null };
	}
	const { path, config } = wrangler;

	if (typeof config.name !== "string" || !config.name) error("wrangler-fields", path, "Set a Worker `name`.");
	if (typeof config.compatibility_date !== "string") error("wrangler-fields", path, "Set a `compatibility_date`.");
	if (typeof config.main !== "string" && !isObject(config.assets)) error("wrangler-fields", path, "Set `main` (the Worker entry) or `assets` (a static site).");

	const vars = isObject(config.vars) ? Object.keys(config.vars) : [];
	for (const name of vars.filter((v) => SECRET_NAME.test(v))) {
		error("vars-not-secret", path, `\`${name}\` looks like a secret but is in \`vars\`, which is public. Remove it and list it in .dev.vars.example.`);
	}

	checkBindings(config, path, error, warn);

	const secretsFile = files.has(".dev.vars.example") ? ".dev.vars.example" : files.has(".env.example") ? ".env.example" : null;
	if (!secretsFile) warn("secrets-documented", ".dev.vars.example", "If the app needs secrets, list their names in .dev.vars.example so buyers are asked for them.");

	if (runtime === "workers-js") {
		const pkg = parseJsonFile(files.get("package.json"));
		const scripts = isObject(pkg?.scripts) ? pkg.scripts : {};
		if (!("build" in scripts) && !("deploy" in scripts) && !isObject(config.build)) {
			warn("build-script", "package.json", "No `build` or `deploy` script. Fine if the Worker needs no build step; otherwise add one so the Deploy button runs it.");
		}
	}

	return { errors, warnings, manifest: buildManifest(config, secretsFile ? files.get(secretsFile)! : "") };
}

function readWrangler(files: Map<string, string>): { path: string; config: Config } | { path: string; error: string } | null {
	for (const path of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
		const text = files.get(path);
		if (text === undefined) continue;
		try {
			if (path.endsWith(".toml")) return { path, config: parseToml(text) as Config };
			const problems: ParseError[] = [];
			const config = parseJsonc(text, problems, { allowTrailingComma: true });
			if (problems.length > 0 || !isObject(config)) return { path, error: "invalid JSON" };
			return { path, config };
		} catch (e) {
			return { path, error: e instanceof Error ? e.message.split("\n")[0]! : "invalid TOML" };
		}
	}
	return null;
}

const REQUIRED_FIELDS: [key: string, type: ManifestResourceType, fields: string[], nameField: string | null, idField: string | null][] = [
	["kv_namespaces", "kv", ["binding"], null, "id"],
	["d1_databases", "d1", ["binding", "database_name"], "database_name", "database_id"],
	["r2_buckets", "r2", ["binding", "bucket_name"], "bucket_name", null],
	["vectorize", "vectorize", ["binding", "index_name"], "index_name", null],
	["hyperdrive", "hyperdrive", ["binding"], null, "id"],
	["services", "service", ["binding", "service"], "service", null],
	["analytics_engine_datasets", "analytics-engine", ["binding"], "dataset", null],
	["workflows", "workflow", ["binding", "name", "class_name"], "name", null],
];

function checkBindings(config: Config, path: string, error: (r: string, f: string, m: string) => void, warn: (r: string, f: string, m: string) => void): void {
	for (const [key, , fields, , idField] of REQUIRED_FIELDS) {
		for (const [i, b] of list(config[key]).entries()) {
			const missing = fields.filter((f) => typeof b[f] !== "string" || !b[f]);
			if (missing.length) error("binding-complete", path, `${key}[${i}] is missing ${missing.map((m) => `\`${m}\``).join(", ")}.`);
			if (idField && typeof b[idField] === "string") {
				warn("hardcoded-ids", path, `${key}[${i}] has a hard-coded \`${idField}\` from your account. Buyers' deploys create their own; keep the default name so it can be provisioned.`);
			}
		}
	}
	for (const [i, b] of list(isObject(config.queues) ? config.queues.producers : undefined).entries()) {
		if (typeof b.binding !== "string" || typeof b.queue !== "string") error("binding-complete", path, `queues.producers[${i}] needs \`binding\` and \`queue\`.`);
	}
	for (const [i, b] of list(isObject(config.durable_objects) ? config.durable_objects.bindings : undefined).entries()) {
		if (typeof b.name !== "string" || typeof b.class_name !== "string") error("binding-complete", path, `durable_objects.bindings[${i}] needs \`name\` and \`class_name\`.`);
	}
}

/** The Worker entry (`main`) from whichever Wrangler config the repo has. */
export function wranglerMain(files: Map<string, string>): string | undefined {
	const w = readWrangler(files);
	return w && "config" in w && typeof w.config.main === "string" ? w.config.main : undefined;
}

/** PRD D3: resources, variables and secrets a deploy of this config involves. */
export function buildManifest(config: Config, secretsExample: string): DeployManifest {
	const resources: DeployManifest["resources"] = [];
	for (const [key, type, , nameField] of REQUIRED_FIELDS) {
		for (const b of list(config[key])) resources.push({ type, binding: String(b.binding ?? ""), name: nameField && typeof b[nameField] === "string" ? (b[nameField] as string) : null });
	}
	for (const b of list(isObject(config.queues) ? config.queues.producers : undefined)) resources.push({ type: "queue", binding: String(b.binding ?? ""), name: typeof b.queue === "string" ? b.queue : null });
	for (const b of list(isObject(config.durable_objects) ? config.durable_objects.bindings : undefined)) resources.push({ type: "durable-object", binding: String(b.name ?? ""), name: typeof b.class_name === "string" ? b.class_name : null });
	for (const b of list(config.containers)) resources.push({ type: "container", binding: String(b.name ?? b.class_name ?? ""), name: typeof b.image === "string" ? b.image : null });
	const single: [string, ManifestResourceType][] = [["ai", "workers-ai"], ["browser", "browser"], ["images", "images"]];
	for (const [key, type] of single) if (isObject(config[key])) resources.push({ type, binding: String((config[key] as Binding).binding ?? ""), name: null });
	if (isObject(config.assets)) resources.push({ type: "assets", binding: String(config.assets.binding ?? ""), name: typeof config.assets.directory === "string" ? config.assets.directory : null });

	const secrets = secretsExample
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.map((l) => l.split("=")[0]!.trim())
		.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));

	return { resources, envVars: isObject(config.vars) ? Object.keys(config.vars) : [], secrets: [...new Set(secrets)] };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function list(v: unknown): Binding[] {
	return Array.isArray(v) ? v.filter(isObject) : [];
}

function parseJsonFile(text: string | undefined): Record<string, unknown> | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text);
		return isObject(v) ? v : null;
	} catch {
		return null;
	}
}
