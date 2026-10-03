import type { ContractIssue, DeployManifest } from "./manifest";

// Repo lifecycle (PRD R12). A published version pins to a Git tag in the app's Artifacts repo.
export const REPO_STATES = ["draft", "submitted", "published", "unpublished", "removed"] as const;
export type RepoState = (typeof REPO_STATES)[number];

export type TransitionActor = "owner" | "admin";

/**
 * Allowed transitions and who may make them. Owners submit a Git tag for review; an admin approves
 * (publishes) it, which pins the repo to that tag. Admins can also unpublish or remove (R18).
 */
const TRANSITIONS: Record<RepoState, Partial<Record<RepoState, readonly TransitionActor[]>>> = {
	draft: { submitted: ["owner"], removed: ["owner", "admin"] },
	// Admins send a submission back to draft to request changes (with a note).
	submitted: { draft: ["owner", "admin"], published: ["admin"], removed: ["owner", "admin"] },
	published: { unpublished: ["owner", "admin"], removed: ["owner", "admin"] },
	unpublished: { submitted: ["owner"], removed: ["owner", "admin"] },
	removed: {},
};

export function canTransition(from: RepoState, to: RepoState, actor?: TransitionActor): boolean {
	const actors = TRANSITIONS[from][to];
	return !!actors && (actor === undefined || actors.includes(actor));
}


// Target platforms (PRD R24, D4, M1-M4).
export const TARGET_PLATFORMS = ["workers", "pwa", "android", "ios", "download"] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

/** PRD R26: how a repo runs on Cloudflare, and how well appmarket.org supports it. */
export const RUNTIMES = {
	"workers-js": { name: "JavaScript / TypeScript", tier: "supported", note: "Including Next.js, Astro, SvelteKit, Nuxt, React Router, Angular and other frameworks Cloudflare configures automatically." },
	static: { name: "Static site", tier: "supported", note: "HTML, CSS and JavaScript served as static assets." },
	"workers-python": { name: "Python", tier: "supported", note: "Python Workers (Pyodide). Not every Python package runs." },
	"workers-rust": { name: "Rust", tier: "limited", note: "Rust compiled to WebAssembly with workers-rs." },
	container: { name: "Container", tier: "advanced", note: "Any Docker image on Cloudflare Containers. Needs Workers Paid; container time is billed to you." },
} as const;
export type Runtime = keyof typeof RUNTIMES;
export type RuntimeTier = (typeof RUNTIMES)[Runtime]["tier"];
export const CATEGORIES = [
	{ slug: "ai", name: "AI" },
	{ slug: "developer-tools", name: "Developer tools" },
	{ slug: "productivity", name: "Productivity" },
	{ slug: "business", name: "Business" },
	{ slug: "communication", name: "Communication" },
	{ slug: "content", name: "Content and media" },
	{ slug: "data", name: "Data and analytics" },
	{ slug: "ecommerce", name: "E-commerce" },
	{ slug: "education", name: "Education" },
	{ slug: "games", name: "Games" },
	{ slug: "security", name: "Security" },
	{ slug: "other", name: "Other" },
] as const;
export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

/** Repo as returned by the API. */
export interface Repo {
	id: string;
	slug: string;
	name: string;
	summary: string;
	description: string;
	category: CategorySlug;
	runtime: Runtime;
	platforms: TargetPlatform[];
	license: string | null;
	priceCents: number;
	state: RepoState;
	owner: { id: string; name: string };
	gitRepo: string | null;
	/** Tag awaiting review while submitted, and the commit it pointed to at submission. */
	submittedTag: string | null;
	submittedCommit: string | null;
	/** Tag buyers get, set when an admin publishes, pinned to the reviewed commit. */
	publishedTag: string | null;
	publishedCommit: string | null;
	/** D2/G4 warnings and D3 manifest for the version in review. */
	submittedChecks: { warnings: ContractIssue[]; manifest: DeployManifest | null } | null;
	/** D3: what deploying the published version creates. */
	manifest: DeployManifest | null;
	createdAt: string;
	/** Cowbells (appmarket's stars) from signed-in users. */
	cowbells: number;
	updatedAt: string;
}

export interface RepoPage {
	items: Repo[];
	page: number;
	pageSize: number;
	total: number;
}

/** URL slug from a repo name: lowercase ASCII, hyphen-separated, at most 60 characters. */
export function slugify(name: string): string {
	return (
		name
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60)
			.replace(/-+$/g, "") || "app"
	);
}

/** One row of a repo's lifecycle history (PRD R12, R18). */
export interface RepoEvent {
	from: RepoState;
	to: RepoState;
	actor: { id: string; name: string; role: TransitionActor };
	tag: string | null;
	commit: string | null;
	note: string | null;
	createdAt: string;
}

/** PRD R24: a published version (the changelog is the list of these, newest first). */
export interface RepoVersion {
	tag: string;
	commit: string;
	releaseNotes: string;
	publishedAt: string;
}

/** PRD R24: screenshots, stored in R2. */
export const SCREENSHOT_LIMITS = {
	maxCount: 8,
	maxBytes: 5 * 1024 * 1024,
	types: ["image/png", "image/jpeg", "image/webp"],
} as const;

export interface Screenshot {
	id: string;
	url: string;
	contentType: string;
	position: number;
}

/** Whether the signed-in user rang a repo's cowbell, and the repo's total. */
export interface CowbellStatus {
	cowbelled: boolean;
	count: number;
}

/** Catalog sort orders: newest first, or most cowbells first. */
export const REPO_SORTS = ["newest", "cowbells"] as const;
export type RepoSort = (typeof REPO_SORTS)[number];
