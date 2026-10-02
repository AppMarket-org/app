import type { Listing, Runtime } from "./listing";

/** PRD D6: a one-click deploy of a listing version into the buyer's Cloudflare account. */
export const DEPLOYMENT_STATUSES = ["queued", "building", "deploying", "succeeded", "failed"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Worker names: lowercase letters, digits and dashes, as Cloudflare accepts them. */
export const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface Deployment {
	id: string;
	listingSlug: string;
	listingName: string;
	versionTag: string;
	accountId: string;
	workerName: string;
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

/** Buyer-facing explanations, shared by the listing page and API errors. */
export const DEPLOY_UNAVAILABLE: Record<DeployUnavailableReason, string> = {
	not_published: "Only published versions can be deployed.",
	platform: "This app does not run on Cloudflare Workers.",
	runtime: "One-click deploy is not available for this runtime yet. Clone the code and deploy it with Wrangler.",
	no_config: "This version has no Wrangler config, so it cannot be deployed in one step. Clone the code to run it yourself.",
	paid: "Paid apps can be deployed after checkout.",
};

/** D4: whether a listing shows the Deploy action, and if not, why. The API applies the same rule. */
export function deployAvailability(
	listing: Pick<Listing, "state" | "platforms" | "runtime" | "manifest" | "priceCents">,
): { ok: true } | { ok: false; reason: DeployUnavailableReason } {
	if (listing.state !== "published") return { ok: false, reason: "not_published" };
	if (!listing.platforms.includes("workers")) return { ok: false, reason: "platform" };
	if (!ONE_CLICK_RUNTIMES.includes(listing.runtime)) return { ok: false, reason: "runtime" };
	// D3: the manifest exists only when the published version has a Wrangler config.
	if (!listing.manifest) return { ok: false, reason: "no_config" };
	// R17: paid listings deploy after checkout, which is Phase 2.
	if (listing.priceCents > 0) return { ok: false, reason: "paid" };
	return { ok: true };
}
