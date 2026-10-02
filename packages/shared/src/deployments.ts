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
