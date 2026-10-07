// PRD D6: shell commands for the two Sandbox runners. Paths come from buildDeployConfig, which only
// accepts repo-relative paths; they are still quoted.

/** Installed in sandbox/Dockerfile, outside the repo's workspace. */
const WRANGLER = "/usr/local/bin/wrangler";
/** #87: Python Workers package tool (workers-py), installed with uv in sandbox/Dockerfile. */
const PYWRANGLER = "/usr/local/bin/pywrangler";
const DEPLOY_DIR = "/tmp/appmarket-deploy";
const SECRETS_FILE = "/tmp/appmarket-secrets.json";
/** Each secret is passed as its own variable so the runner redacts every value from failure output. */
export const SECRET_ENV_PREFIX = "APPMARKET_SECRET_";

export interface DeployPlan {
	workerName: string;
	config: Record<string, unknown>;
	assetsDir: string | null;
	d1Migrations: { binding: string; dir: string }[];
	/** #87: set for Python Workers (sources uploaded unbundled). */
	python?: { sourceDir: string };
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Runs without the buyer's token: installs dependencies with the lockfile the repo ships and
 * bundles the Worker (running any custom build from its Wrangler config) into .appmarket/out, or
 * for a static site runs its `build` script.
 */
export function buildCommand(plan: DeployPlan): string {
	const install = [
		"if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile",
		"elif [ -f package-lock.json ]; then npm ci",
		"elif [ -f package.json ]; then npm install",
		"fi",
	].join("; ");
	if (plan.python) {
		// #87: vendor the pyproject.toml dependencies into python_modules/; nothing is bundled.
		return `set -e; ${install}; if [ -f pyproject.toml ]; then ${PYWRANGLER} sync; fi`;
	}
	// Rust Workers build here too: Wrangler runs the repo's build.command (worker-build) first.
	if (typeof plan.config.main === "string") return `set -e; ${install}; ${WRANGLER} deploy --dry-run --outdir .appmarket/out`;
	// A static site (assets, no Worker): the repo's `build` script writes the assets directory
	// (an Angular, React or Vite app); a site with its files checked in has none.
	const build = "if [ -f package.json ]; then if [ -f pnpm-lock.yaml ]; then pnpm run --if-present build; else npm run build --if-present; fi; fi";
	return `set -e; ${install}; ${build}`;
}

/**
 * Runs with the buyer's token. Copies only the build output, assets and migrations into a clean
 * directory (no repo scripts, package.json or .env files), then runs the image's Wrangler there.
 */
export function deployCommand(plan: DeployPlan): string {
	const copy: string[] = [];
	if (plan.python) {
		// Only .py sources and the vendored packages: Wrangler reads them, nothing runs them here.
		const dir = plan.python.sourceDir;
		copy.push(
			dir === "." ? `find . -maxdepth 1 -name '*.py' -exec cp {} ${DEPLOY_DIR}/ \\;` : `mkdir -p ${DEPLOY_DIR}/${quote(dir)} && cp -R ${quote(dir)}/. ${DEPLOY_DIR}/${quote(dir)}/`,
			`if [ -d python_modules ]; then cp -R python_modules ${DEPLOY_DIR}/python_modules; fi`,
		);
	} else if (typeof plan.config.main === "string") copy.push(`cp -R .appmarket/out ${DEPLOY_DIR}/out`);
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
