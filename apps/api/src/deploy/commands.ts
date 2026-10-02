// PRD D6: shell commands for the two Sandbox runners. Paths come from buildDeployConfig, which only
// accepts repo-relative paths; they are still quoted.

/** Installed in sandbox/Dockerfile, outside the listing's workspace. */
const WRANGLER = "/usr/local/bin/wrangler";
const DEPLOY_DIR = "/tmp/appmarket-deploy";
const SECRETS_FILE = "/tmp/appmarket-secrets.json";
/** Each secret is passed as its own variable so the runner redacts every value from failure output. */
export const SECRET_ENV_PREFIX = "APPMARKET_SECRET_";

export interface DeployPlan {
	workerName: string;
	config: Record<string, unknown>;
	assetsDir: string | null;
	d1Migrations: { binding: string; dir: string }[];
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Runs without the buyer's token: installs dependencies with the lockfile the listing ships and
 * bundles the Worker (running any custom build from its Wrangler config) into .appmarket/out.
 */
export function buildCommand(plan: DeployPlan): string {
	const install = [
		"if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile",
		"elif [ -f package-lock.json ]; then npm ci",
		"elif [ -f package.json ]; then npm install",
		"fi",
	].join("; ");
	const bundle = typeof plan.config.main === "string" ? `${WRANGLER} deploy --dry-run --outdir .appmarket/out` : "true";
	return `set -e; ${install}; ${bundle}`;
}

/**
 * Runs with the buyer's token. Copies only the build output, assets and migrations into a clean
 * directory (no listing scripts, package.json or .env files), then runs the image's Wrangler there.
 */
export function deployCommand(plan: DeployPlan): string {
	const copy: string[] = [];
	if (typeof plan.config.main === "string") copy.push(`cp -R .appmarket/out ${DEPLOY_DIR}/out`);
	if (plan.assetsDir) copy.push(`cp -R ${quote(plan.assetsDir)} ${DEPLOY_DIR}/assets`);
	for (const { binding, dir } of plan.d1Migrations) copy.push(`if [ -d ${quote(dir)} ]; then cp -R ${quote(dir)} ${DEPLOY_DIR}/migrations/${binding}; fi`);
	const migrate = plan.d1Migrations.map(
		({ binding }) => `if [ -n "$(ls -A migrations/${binding} 2>/dev/null)" ]; then ${WRANGLER} d1 migrations apply ${binding} --remote --config wrangler.json; fi`,
	);
	const writeSecrets = `node -e 'const p=${JSON.stringify(SECRET_ENV_PREFIX)};const s=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith(p)).map(([k,v])=>[k.slice(p.length),v]));require("fs").writeFileSync(${JSON.stringify(SECRETS_FILE)},JSON.stringify(s),{mode:0o600})'`;
	return [
		"set -eu",
		`trap 'rm -f ${SECRETS_FILE}' EXIT`,
		`rm -rf ${DEPLOY_DIR} && mkdir -p ${DEPLOY_DIR}/migrations`,
		...copy,
		`find ${DEPLOY_DIR} \\( -name '.env*' -o -name '.dev.vars*' -o -name '.npmrc' -o -name '.wrangler' \\) -prune -exec rm -rf {} +`,
		writeSecrets,
		`cd ${DEPLOY_DIR}`,
		`printf '%s' "$APPMARKET_DEPLOY_CONFIG" > wrangler.json`,
		`${WRANGLER} deploy --config wrangler.json --secrets-file ${SECRETS_FILE}`,
		...migrate,
	].join("\n");
}

/** The workers.dev URL Wrangler prints after a deploy, if the account has a workers.dev subdomain. */
export function workerUrl(stdout: string, workerName: string): string | null {
	const escaped = workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return stdout.match(new RegExp(`https://${escaped}\\.[a-z0-9-]+\\.workers\\.dev`))?.[0] ?? null;
}
