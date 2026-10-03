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
}

export interface OrgMembership {
	org: Owner;
	role: OrgRole;
}

export interface OrgMember {
	userId: string;
	handle: string;
	name: string;
	role: OrgRole;
}

/** #104: one signed-in browser or device (no token). */
export interface SessionInfo {
	id: string;
	/** Browser user agent; null for device logins (CLIs, agents). */
	userAgent: string | null;
	createdAt: string;
	expiresAt: string;
	current: boolean;
}
