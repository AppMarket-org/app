// PRD D6: the Wrangler config a one-click deploy uploads to the buyer's account. It is built here,
// from the published commit's config, instead of using the repo's file as-is: the deploy step holds
// the buyer's Cloudflare token, so it must not run anything the listing controls (custom builds,
// plugins, .env files). The listing's build runs earlier, without the token, and writes its bundle
// to `out/`; the deploy step uploads that bundle with this config and `no_bundle`.
import { readWrangler, type WranglerConfig } from "./wrangler";

export interface DeployConfig {
	/** Written as wrangler.json in the deploy directory. */
	config: WranglerConfig;
	/** Static assets directory relative to the repo root, copied to `assets/`; null without assets. */
	assetsDir: string | null;
	/** D1 migrations directories relative to the repo root, copied to `migrations/<binding>/`. */
	d1Migrations: { binding: string; dir: string }[];
}

export type DeployConfigResult = { ok: true; deploy: DeployConfig } | { ok: false; reason: string };

/** Keys copied from the listing's config. Anything else (build, routes, env, account_id, ...) is dropped. */
const COPIED = [
	"compatibility_date",
	"compatibility_flags",
	"vars",
	"kv_namespaces",
	"d1_databases",
	"r2_buckets",
	"durable_objects",
	"migrations",
	"queues",
	"vectorize",
	"services",
	"analytics_engine_datasets",
	"workflows",
	"ai",
	"browser",
	"images",
	"observability",
	"triggers",
	"limits",
	"placement",
	"send_email",
	"version_metadata",
] as const;

/** Bindings a deploy cannot set up yet; the listing page says so instead of failing mid-deploy. */
const UNSUPPORTED: [key: string, label: string][] = [
	["containers", "Containers"],
	["hyperdrive", "Hyperdrive"],
	["dispatch_namespaces", "dispatch namespaces"],
	["unsafe", "unsafe bindings"],
];

export function buildDeployConfig(files: Map<string, string>, workerName: string): DeployConfigResult {
	const wrangler = readWrangler(files);
	if (!wrangler) return { ok: false, reason: "No Wrangler config in this version." };
	if ("error" in wrangler) return { ok: false, reason: `${wrangler.path} could not be parsed.` };
	const source = wrangler.config;

	for (const [key, label] of UNSUPPORTED) {
		const value = source[key];
		if (value !== undefined && !(Array.isArray(value) && value.length === 0)) return { ok: false, reason: `One-click deploy does not support ${label} yet.` };
	}
	if (typeof source.compatibility_date !== "string") return { ok: false, reason: "The Wrangler config has no compatibility_date." };

	const config: WranglerConfig = { name: workerName, workers_dev: true };
	for (const key of COPIED) if (source[key] !== undefined) config[key] = JSON.parse(JSON.stringify(source[key]));

	const scoped = (name: unknown) => scopedName(workerName, typeof name === "string" ? name : "");
	// Resource IDs in the listing belong to the developer's account. Without them Wrangler provisions
	// the resources in the buyer's account; names are scoped to the Worker so two apps never share one.
	for (const kv of list(config.kv_namespaces)) {
		delete kv.id;
		delete kv.preview_id;
	}
	const d1Migrations: DeployConfig["d1Migrations"] = [];
	for (const db of list(config.d1_databases)) {
		delete db.database_id;
		delete db.preview_database_id;
		db.database_name = scoped(db.database_name);
		const dir = typeof db.migrations_dir === "string" ? db.migrations_dir : "migrations";
		if (!isRepoPath(dir)) return { ok: false, reason: `d1_databases migrations_dir must be a path inside the repo.` };
		const binding = String(db.binding ?? "");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding)) return { ok: false, reason: "Every d1_databases entry needs a valid binding." };
		d1Migrations.push({ binding, dir: normalize(dir) });
		db.migrations_dir = `migrations/${binding}`;
	}
	for (const bucket of list(config.r2_buckets)) {
		delete bucket.preview_bucket_name;
		bucket.bucket_name = scoped(bucket.bucket_name);
	}
	const queues = isObject(config.queues) ? config.queues : null;
	for (const producer of list(queues?.producers)) producer.queue = scoped(producer.queue);
	for (const consumer of list(queues?.consumers)) consumer.queue = scoped(consumer.queue);
	for (const workflow of list(config.workflows)) workflow.name = scoped(workflow.name);

	let assetsDir: string | null = null;
	if (isObject(source.assets)) {
		const directory = source.assets.directory;
		if (typeof directory !== "string" || !isRepoPath(directory)) return { ok: false, reason: "assets.directory must be a path inside the repo." };
		assetsDir = normalize(directory);
		const { binding, html_handling, not_found_handling, run_worker_first } = source.assets;
		config.assets = { directory: "assets", ...defined({ binding, html_handling, not_found_handling, run_worker_first }) };
	}

	if (typeof source.main === "string") {
		// `wrangler deploy --dry-run --outdir out` names the bundle after the entry file.
		const base = source.main.split("/").pop()!.replace(/\.[cm]?[jt]sx?$/, "");
		Object.assign(config, { main: `out/${base}.js`, no_bundle: true, find_additional_modules: true, base_dir: "out" });
	} else if (!assetsDir) {
		return { ok: false, reason: "The Wrangler config needs `main` or `assets`." };
	}

	return { ok: true, deploy: { config, assetsDir, d1Migrations } };
}

/** `<worker>-<name>`, limited to the characters and length D1, R2, Queues and Workflows all accept. */
export function scopedName(workerName: string, name: string): string {
	const slug = `${workerName}-${name || "data"}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-");
	return slug.slice(0, 63).replace(/-+$/, "");
}

/** A relative path that stays inside the repo. */
function isRepoPath(path: string): boolean {
	const clean = normalize(path);
	return clean !== "" && !path.startsWith("/") && !path.includes("\\") && !clean.split("/").includes("..");
}

function normalize(path: string): string {
	return path.split("/").filter((part) => part && part !== ".").join("/");
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function list(v: unknown): Record<string, unknown>[] {
	return Array.isArray(v) ? v.filter(isObject) : [];
}

function defined(values: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}
