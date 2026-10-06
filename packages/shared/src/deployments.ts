import type { Repo, Runtime } from "./repo";

/** PRD D6: a one-click deploy of a repo version into the buyer's Cloudflare account. */
export const DEPLOYMENT_STATUSES = ["queued", "building", "deploying", "succeeded", "failed"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Worker names: lowercase letters, digits and dashes, as Cloudflare accepts them. */
export const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface Deployment {
	id: string;
	/** `owner/slug` of the deployed repo (#102). */
	repoFullName: string;
	repoName: string;
	versionTag: string;
	accountId: string;
	workerName: string;
	/** #28: set for branch previews. */
	previewBranch: string | null;
	status: DeploymentStatus;
	/** workers.dev URL once deployed. */
	url: string | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * PRD D4: runtimes the one-click deploy pipeline builds. Python (pywrangler) and Rust
 * (worker-build) toolchains are in the build image since #87; container apps (#54) deploy a
 * published, digest-pinned image, so no Docker is needed.
 */
export const ONE_CLICK_RUNTIMES: readonly Runtime[] = ["workers-js", "static", "workers-python", "workers-rust", "container"];

export type DeployUnavailableReason = "not_published" | "platform" | "runtime" | "no_config" | "paid";

/** Buyer-facing explanations, shared by the repo page and API errors. */
export const DEPLOY_UNAVAILABLE: Record<DeployUnavailableReason, string> = {
	not_published: "Only published versions can be deployed.",
	platform: "This app does not run on Cloudflare Workers.",
	runtime: "One-click deploy is not available for this runtime yet. Clone the code and deploy it with Wrangler.",
	no_config: "This version has no Wrangler config, so it cannot be deployed in one step. Clone the code to run it yourself.",
	paid: "Buy this app to deploy it.",
};

/** D4: whether a repo shows the Deploy action, and if not, why. The API applies the same rule. */
export function deployAvailability(
	repo: Pick<Repo, "state" | "platforms" | "runtime" | "manifest" | "priceCents">,
	/** #213: the viewer bought the app (or edits it). */
	owned = false,
): { ok: true } | { ok: false; reason: DeployUnavailableReason } {
	if (repo.state !== "published") return { ok: false, reason: "not_published" };
	if (!repo.platforms.includes("workers")) return { ok: false, reason: "platform" };
	if (!ONE_CLICK_RUNTIMES.includes(repo.runtime)) return { ok: false, reason: "runtime" };
	// D3: the manifest exists only when the published version has a Wrangler config.
	if (!repo.manifest) return { ok: false, reason: "no_config" };
	// R17: paid apps deploy after purchase.
	if (repo.priceCents > 0 && !owned) return { ok: false, reason: "paid" };
	return { ok: true };
}

/** #38 (D8): one version of the deployed Worker in the buyer's account. */
export interface WorkerVersion {
	id: string;
	number: number;
	createdAt: string;
	/** Annotation message, e.g. "Rolled back via appmarket.org". */
	message: string | null;
	/** How it was made: "wrangler"/"cf" uploads, the dashboard, an API call. */
	source: string | null;
	/** Share of traffic it serves now (0 when not deployed). */
	percentage: number;
}

/** #28 (R8): branch previews, deployed into the developer's own Cloudflare account. */
export interface PreviewSettings {
	/** Previews of non-default branches. */
	enabled: boolean;
	/** #37: the default branch redeploys to `workerName` on every push. */
	deployDefault: boolean;
	workerName: string | null;
	accountId: string;
	/** Name of the person whose Cloudflare connection deploys them. */
	connectedBy: string;
	/** True when that is the signed-in user (only they can change the account). */
	mine: boolean;
}

export interface BranchPreview {
	branch: string;
	/** #192: the Worker was deleted (until the next push to the branch). */
	deleted: boolean;
	workerName: string;
	/** D1, KV and R2 resources the preview created in the account (names). */
	resources: string[];
	commit: string;
	deploymentId: string;
	status: DeploymentStatus;
	url: string | null;
	error: string | null;
	updatedAt: string;
}

/** At most this many branches per repo get previews (newest pushes first). */
export const MAX_PREVIEW_BRANCHES = 10;

/**
 * Worker name for a branch preview: `<slug>-pr-<branch>`, a valid Worker name (lowercase, digits
 * and dashes, at most 63 characters), with a short hash when the branch had to be shortened or
 * changed so two branches never share a Worker.
 */
export function previewWorkerName(slug: string, branch: string): string {
	const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	const b = clean(branch) || "branch";
	let hash = 0;
	for (const ch of branch) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
	const exact = b === branch;
	const base = `${clean(slug).slice(0, 30)}-pr-${b}`;
	if (exact && base.length <= 63) return base;
	const tag = hash.toString(36).slice(0, 6);
	return `${base.slice(0, 63 - tag.length - 1).replace(/-+$/, "")}-${tag}`;
}

/** #40 (D10): one runtime log event of a deployed Worker, from Workers Logs in the buyer's account. */
export interface RuntimeLogEvent {
	timestamp: string;
	level: string;
	message: string;
	/** e.g. "GET /api/todos" or "cron". */
	trigger: string | null;
	outcome: string | null;
}

/** #41 (D11): EJECT.md, the steps to own and deploy an app without appmarket.org. */
export function buildEjectGuide(p: { repo: string; version: string; commit: string; folder: string; d1Bindings: string[] }): string {
	const migrations = p.d1Bindings.map((b) => `npx wrangler d1 migrations apply ${b} --remote`);
	return [
		`# ${p.repo} ${p.version}, ejected from appmarket.org`,
		"",
		`This is the exact code you deployed (commit ${p.commit}), with a \`wrangler.json\` for the Worker and the resources already in your Cloudflare account. Nothing here depends on appmarket.org.`,
		"",
		"## Own the code",
		"",
		"```sh",
		`cd ${p.folder}`,
		"git init && git add -A",
		`git commit -m "Start from ${p.repo} ${p.version} (${p.commit.slice(0, 12)})"`,
		"```",
		"",
		"Push it to any Git host you like.",
		"",
		"## Deploy with Wrangler",
		"",
		"```sh",
		"npm install            # or pnpm install, matching the lockfile",
		"npx wrangler login     # the Cloudflare account you deployed to",
		...migrations,
		"npx wrangler deploy",
		"```",
		"",
		"`wrangler.json` keeps the Worker name and resource names appmarket.org used, so the deploy updates the same Worker and reuses its data. Secrets you set at deploy time stay on the Worker; change them with `npx wrangler secret put NAME`.",
		"",
		"Updates from the app's developer no longer reach this copy. To take one later, compare it with the app's newer versions yourself.",
		"",
	].join("\n");
}

/** #39 (D9): a custom domain attached to the deployed Worker in the buyer's account. */
export interface WorkerDomain {
	id: string;
	hostname: string;
	zoneName: string | null;
}

/** A hostname a buyer can attach: lowercase labels, no wildcard, at most 253 characters. */
export const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** #51 (D13): a deployed Worker's configuration as the buyer sees it. Secret values never leave Cloudflare. */
export interface WorkerConfig {
	vars: { name: string; value: string }[];
	secrets: string[];
	/** Secrets the app declares (.dev.vars.example / .env.example). */
	required: string[];
	/** Declared secrets that are not set on the Worker. */
	missing: string[];
}

/** Environment variable and secret names: letters, digits and underscores, not starting with a digit. */
export const CONFIG_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Workers allow 5 KB per variable and per secret. */
export const CONFIG_VALUE_MAX = 5 * 1024;

/**
 * #307: one app running in a Cloudflare account (a Worker), from its deployments. Each deploy
 * replaces the Worker's version, so an app is live from its latest successful deployment.
 */
export interface RunningApp {
	key: string;
	accountId: string;
	workerName: string;
	repoName: string;
	repoFullName: string;
	/** The deployment that is live (the latest that succeeded), if any. */
	live: Deployment | null;
	/** The latest deployment of any status (newer than `live` when a deploy failed or is running). */
	latest: Deployment;
	deployments: number;
}

/** Groups deployments (any order) into apps, most recently deployed first. */
export function runningApps(deployments: readonly Deployment[]): RunningApp[] {
	const apps = new Map<string, RunningApp>();
	for (const d of [...deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
		const key = `${d.accountId}/${d.workerName}`;
		const app = apps.get(key);
		if (!app) apps.set(key, { key, accountId: d.accountId, workerName: d.workerName, repoName: d.repoName, repoFullName: d.repoFullName, live: d.status === "succeeded" ? d : null, latest: d, deployments: 1 });
		else {
			app.deployments++;
			if (!app.live && d.status === "succeeded") app.live = d;
		}
	}
	return [...apps.values()];
}
