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
 * PRD D4: runtimes the one-click deploy pipeline builds today. Python and Rust Workers need their
 * toolchains in the build image; Container apps wait for R27.
 */
export const ONE_CLICK_RUNTIMES: readonly Runtime[] = ["workers-js", "static"];

export type DeployUnavailableReason = "not_published" | "platform" | "runtime" | "no_config" | "paid";

/** Buyer-facing explanations, shared by the repo page and API errors. */
export const DEPLOY_UNAVAILABLE: Record<DeployUnavailableReason, string> = {
	not_published: "Only published versions can be deployed.",
	platform: "This app does not run on Cloudflare Workers.",
	runtime: "One-click deploy is not available for this runtime yet. Clone the code and deploy it with Wrangler.",
	no_config: "This version has no Wrangler config, so it cannot be deployed in one step. Clone the code to run it yourself.",
	paid: "Paid apps can be deployed after checkout.",
};

/** D4: whether a repo shows the Deploy action, and if not, why. The API applies the same rule. */
export function deployAvailability(
	repo: Pick<Repo, "state" | "platforms" | "runtime" | "manifest" | "priceCents">,
): { ok: true } | { ok: false; reason: DeployUnavailableReason } {
	if (repo.state !== "published") return { ok: false, reason: "not_published" };
	if (!repo.platforms.includes("workers")) return { ok: false, reason: "platform" };
	if (!ONE_CLICK_RUNTIMES.includes(repo.runtime)) return { ok: false, reason: "runtime" };
	// D3: the manifest exists only when the published version has a Wrangler config.
	if (!repo.manifest) return { ok: false, reason: "no_config" };
	// R17: paid repos deploy after checkout, which is Phase 2.
	if (repo.priceCents > 0) return { ok: false, reason: "paid" };
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
	enabled: boolean;
	accountId: string;
	/** Name of the person whose Cloudflare connection deploys them. */
	connectedBy: string;
	/** True when that is the signed-in user (only they can change the account). */
	mine: boolean;
}

export interface BranchPreview {
	branch: string;
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
