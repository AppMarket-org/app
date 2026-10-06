import type { CheckpointVisibility } from "./checkpoints";
import type { OwnerKind } from "./owners";
import type { ContractIssue, DeployManifest, PwaCheck } from "./manifest";

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
	// An update to a published app: the owner submits a new version while the app stays public on
	// the current one; an admin publishes it (published -> published) or sends it back (-> draft,
	// which only clears the update). The API allows the last two only while an update is pending.
	published: { submitted: ["owner"], published: ["admin"], draft: ["owner", "admin"], unpublished: ["owner", "admin"], removed: ["owner", "admin"] },
	unpublished: { submitted: ["owner"], removed: ["owner", "admin"] },
	removed: {},
};

/** A published app with a newer version waiting for review (it stays public meanwhile). */
export const hasPendingUpdate = (repo: { state: RepoState; submittedTag: string | null }) => repo.state === "published" && !!repo.submittedTag;

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
	/** The user or organization the repo lives under: appmarket.org/<owner.handle>/<slug>. */
	owner: { id: string; handle: string; kind: OwnerKind; name: string; avatarUrl: string | null };
	/** `owner/slug`, the repo's path on the site and in the API. */
	fullName: string;
	gitRepo: string | null;
	/** Tag awaiting review while submitted, and the commit it pointed to at submission. */
	submittedTag: string | null;
	submittedCommit: string | null;
	/** Tag buyers get, set when an admin publishes, pinned to the reviewed commit. */
	publishedTag: string | null;
	publishedCommit: string | null;
	/** D2/G4 warnings, D3 manifest and #32 PWA check for the version in review. */
	submittedChecks: { warnings: ContractIssue[]; manifest: DeployManifest | null; pwa?: PwaCheck } | null;
	/** The runtime was detected from the code (it is null-ish until the first push). */
	runtimeDetected: boolean;
	/** #33: Android package name the developer declared as verified with Google; APK downloads need it. */
	android: { package: string; verifiedAt: string } | null;
	/** #32: live demo URL (also the web app install URL). */
	demoUrl: string | null;
	/** #32: installability of the published version. */
	pwa: PwaCheck | null;
	/** D3: what deploying the published version creates. */
	manifest: DeployManifest | null;
	createdAt: string;
	/** #29: id of the repo whose agent session this fork is; such forks are never submitted. */
	sessionOf: string | null;
	/** #30: the public GitHub repository (and branch) its code was imported from. */
	importedFrom: string | null;
	/** #26: the published app this repo was forked from, at which tag and commit. */
	forkedFrom: { fullName: string; tag: string | null; commit: string | null } | null;
	/** #170: bytes per language in the published version (null until computed). */
	languages: Record<string, number> | null;
	/** Checkpoints PRD: default visibility for new checkpoints on this repo. */
	checkpointVisibility: CheckpointVisibility;
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

/** #34: a push webhook as the owner sees it (secrets are never returned after creation). */
export interface RepoWebhook {
	id: string;
	url: string;
	format: "generic" | "github";
	createdAt: string;
	deliveries: { id: string; ref: string; sha: string; status: number | null; error: string | null; createdAt: string }[];
}
