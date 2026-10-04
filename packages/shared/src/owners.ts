/** #102: users and organizations share one namespace of handles (GitHub rules). */
export const OWNER_KINDS = ["user", "org"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const ORG_ROLES = ["owner", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** a-z and 0-9 with single hyphens between, at most 39 characters. Compared case-insensitively. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

/** Handles that would clash with site paths (appmarket.org/<handle>) or are misleading. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	"about", "account", "admin", "api", "apps", "assets", "auth", "blog", "brand", "category", "cdn-cgi", "contact",
	"dashboard", "deploy", "deployments", "docs", "explore", "help", "home", "legal", "login", "logout", "marketplace",
	"device", "me", "new", "orgs", "organizations", "pricing", "privacy", "search", "security", "settings", "signin", "signup",
	"sitemap", "sitemaps", "static", "status", "support", "terms", "user", "users", "www", "appmarket", "cloudflare",
]);

/** Why a handle cannot be used, or null if it is valid (availability is checked separately). */
export function handleProblem(handle: string): string | null {
	if (!HANDLE_PATTERN.test(handle)) return "Use lowercase letters, numbers and single hyphens (up to 39), starting and ending with a letter or number.";
	if (RESERVED_HANDLES.has(handle)) return "That name is reserved.";
	return null;
}

export interface Owner {
	id: string;
	handle: string;
	kind: OwnerKind;
	/** Profile name for users, display name for organizations. */
	name: string;
	/** #140: uploaded picture, else the sign-in provider's picture (users), else null (show an initial). */
	avatarUrl: string | null;
}

/** #139: public profile fields; empty ones are left out. */
export interface OwnerProfile {
	/** A user's bio or an organization's description (160 characters). */
	bio?: string;
	location?: string;
	/** https only. */
	website?: string;
	/** When the account or organization was created (ISO). */
	memberSince: string;
	/** #146: the owner hides their activity feed. */
	activityHidden?: boolean;
}

/** #146: what a user shows on their profile (returned to the user themself only). */
export interface OwnerPrivacy {
	privateContributions: boolean;
	hideActivity: boolean;
	hideLocation: boolean;
}

/** What a user or organization owner edits; null or "" clears a field. */
export interface OwnerProfileUpdate {
	name?: string | null;
	bio?: string | null;
	location?: string | null;
	website?: string | null;
	privateContributions?: boolean;
	hideActivity?: boolean;
	hideLocation?: boolean;
}

export const AVATAR_LIMITS = { maxBytes: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] } as const;

export const MAX_PINS = 6;

export type ContributionKind = "commit" | "repo" | "version" | "release" | "checkpoint";

/** #145: a month of activity, grouped by kind, each broken down by repo. */
export interface ActivityMonth {
	/** YYYY-MM */
	month: string;
	groups: { kind: ContributionKind; total: number; repos: { fullName: string; name: string; count: number }[] }[];
	/** #146: contributions in unpublished repos, when the user opted in; never with names. */
	privateCount?: number;
}

export interface ActivityPage {
	months: ActivityMonth[];
	/** Pass as `before` for older months; null at the end. */
	next: string | null;
	/** #146: the user hides their activity. */
	hidden?: boolean;
}

/** #144: a user's contributions per UTC day over a year (or the last 12 months). */
export interface ContributionCalendar {
	/** First and last day shown (YYYY-MM-DD, inclusive). */
	from: string;
	to: string;
	total: number;
	/** Days with contributions only. */
	days: Record<string, number>;
	/** Years with any contributions, newest first, for the year selector. */
	years: number[];
}

export const PROFILE_LIMITS = { name: 80, bio: 160, location: 80, website: 200 } as const;

export interface OrgMembership {
	org: Owner;
	role: OrgRole;
	/** #141: shown on the organization's profile and the member's. */
	public: boolean;
}

export interface OrgMember {
	userId: string;
	handle: string;
	name: string;
	role: OrgRole;
	avatarUrl: string | null;
}

/** #140: the URL for an owner's picture: an upload, else (users) the sign-in provider's picture. */
export function avatarUrl(avatarId: string | null | undefined, providerImage?: string | null): string | null {
	if (avatarId) return `/api/media/avatars/${avatarId}`;
	return providerImage && /^https:\/\//.test(providerImage) ? providerImage : null;
}

/** #104: one signed-in browser or device (no token). */
export interface SessionInfo {
	id: string;
	/** Browser user agent; null for device logins (CLIs, agents). */
	userAgent: string | null;
	createdAt: string;
	expiresAt: string;
	current: boolean;
	/** #107: set for device logins (CLIs, agents): client, name and granted scopes. */
	device: { clientId: string; name: string; scopes: string[] } | null;
	/** #133: last request with this session, and its network prefix (/24 or /48). */
	lastUsedAt: string | null;
	ipPrefix: string | null;
}
