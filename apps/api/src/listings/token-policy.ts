import type { Listing, Role } from "@appmarket/shared";

export type TokenDecision = { allowed: true } | { allowed: false; status: 403 | 404 | 409; error: string };

/**
 * PRD R3: who may mint which token. Write: the listing owner only. Read: owner or admin for any
 * listing; any signed-in user once published (clone, fork, eject). Hidden listings stay 404.
 */
export function tokenPolicy(listing: Listing, user: { id: string; role: Role }, scope: "read" | "write"): TokenDecision {
	const isOwner = listing.owner.id === user.id;
	const isAdmin = user.role === "admin";
	if (listing.state !== "published" && !isOwner && !isAdmin) return { allowed: false, status: 404, error: "not_found" };
	if (listing.state === "removed") return { allowed: false, status: 409, error: "removed" };
	if (!listing.repoName) return { allowed: false, status: 409, error: "no_repo" };
	if (scope === "write" && !isOwner) return { allowed: false, status: 403, error: "forbidden" };
	return { allowed: true };
}
