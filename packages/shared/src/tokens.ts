/** PRD R3: repo-scoped Artifacts tokens. Read for clone/fetch, write for push. Lifetimes in seconds. */
export const TOKEN_TTL = {
	default: 3600,
	min: 60,
	max: { read: 86_400, write: 28_800 },
} as const;


/** Returned once; never stored or logged by appmarket.org. */
export interface RepoToken {
	scope: "read" | "write";
	remote: string;
	token: string;
	expiresAt: string;
}

/** PRD R19: per-developer limit on listings that are not removed. Admins are exempt. */
export const MAX_LISTINGS_PER_DEVELOPER = 25;

/** A minted token as shown to its listing's owner or an admin (never the token itself). */
export interface TokenRecord {
	id: string;
	scope: "read" | "write";
	/** Live state from Artifacts; "unknown" if Artifacts no longer lists it. */
	state: "active" | "expired" | "revoked" | "unknown";
	mintedBy: { id: string; name: string };
	createdAt: string;
	expiresAt: string;
	revokedAt: string | null;
}
