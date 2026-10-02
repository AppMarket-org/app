import { z } from "zod";

// Listing lifecycle (PRD R12). A published version pins to a Git tag in the app's Artifacts repo.
export const LISTING_STATES = ["draft", "submitted", "published", "unpublished", "removed"] as const;
export type ListingState = (typeof LISTING_STATES)[number];

export type TransitionActor = "owner" | "admin";

/**
 * Allowed transitions and who may make them. Owners submit a Git tag for review; an admin approves
 * (publishes) it, which pins the listing to that tag. Admins can also unpublish or remove (R18).
 */
const TRANSITIONS: Record<ListingState, Partial<Record<ListingState, readonly TransitionActor[]>>> = {
	draft: { submitted: ["owner"], removed: ["owner", "admin"] },
	submitted: { draft: ["owner"], published: ["admin"], removed: ["owner", "admin"] },
	published: { unpublished: ["owner", "admin"], removed: ["owner", "admin"] },
	unpublished: { submitted: ["owner"], removed: ["owner", "admin"] },
	removed: {},
};

export function canTransition(from: ListingState, to: ListingState, actor?: TransitionActor): boolean {
	const actors = TRANSITIONS[from][to];
	return !!actors && (actor === undefined || actors.includes(actor));
}

/** A Git tag name we accept for a submitted version: a safe subset of git's ref rules. */
export const gitTagSchema = z
	.string()
	.trim()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, "Use letters, digits, '.', '_', '-' or '/'")
	.refine((t) => !t.includes("..") && !t.endsWith(".lock") && !t.endsWith("/") && !t.endsWith("."), "Not a valid Git tag name");

export const transitionSchema = z.discriminatedUnion("to", [
	z.object({ to: z.literal("submitted"), tag: gitTagSchema, releaseNotes: z.string().trim().max(10_000).default("") }),
	z.object({ to: z.literal("published"), note: z.string().max(500).optional() }),
	z.object({ to: z.literal("draft") }),
	z.object({ to: z.literal("unpublished"), note: z.string().max(500).optional() }),
	z.object({ to: z.literal("removed"), note: z.string().max(500).optional() }),
]);
export type TransitionRequest = z.infer<typeof transitionSchema>;

// Target platforms (PRD R24, D4, M1-M4).
export const TARGET_PLATFORMS = ["workers", "pwa", "android", "ios", "download"] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

/** PRD R26: how a listing runs on Cloudflare, and how well appmarket.org supports it. */
export const RUNTIMES = {
	"workers-js": { name: "JavaScript / TypeScript", tier: "supported", note: "Including Next.js, Astro, SvelteKit, Nuxt, React Router, Angular and other frameworks Cloudflare configures automatically." },
	static: { name: "Static site", tier: "supported", note: "HTML, CSS and JavaScript served as static assets." },
	"workers-python": { name: "Python", tier: "supported", note: "Python Workers (Pyodide). Not every Python package runs." },
	"workers-rust": { name: "Rust", tier: "limited", note: "Rust compiled to WebAssembly with workers-rs." },
	container: { name: "Container", tier: "advanced", note: "Any Docker image on Cloudflare Containers. Needs Workers Paid; container time is billed to you." },
} as const;
export type Runtime = keyof typeof RUNTIMES;
export type RuntimeTier = (typeof RUNTIMES)[Runtime]["tier"];
const runtimeKeys = Object.keys(RUNTIMES) as [Runtime, ...Runtime[]];
export const runtimeSchema = z.enum(runtimeKeys);

/** SPDX license identifier, for example MIT or Apache-2.0, or a simple expression such as "MIT OR Apache-2.0". */
export const licenseSchema = z
	.string()
	.trim()
	.max(64)
	.regex(/^[A-Za-z0-9.+-]+( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$/, "Use an SPDX identifier such as MIT or Apache-2.0");

// Catalog categories (PRD R1). Slugs appear in /category/:slug URLs.
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
const categorySlugs = CATEGORIES.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];

/** Fields a developer sets when creating or editing a listing (PRD R1). Price is free-only in Phase 1 (R17). */
const listingFields = {
	name: z.string().trim().min(3).max(80),
	summary: z.string().trim().min(10).max(160),
	description: z.string().trim().max(20_000),
	category: z.enum(categorySlugs),
	runtime: runtimeSchema,
	platforms: z
		.array(z.enum(TARGET_PLATFORMS))
		.min(1)
		.max(TARGET_PLATFORMS.length)
		.transform((p) => [...new Set(p)]),
	license: licenseSchema.nullable(),
};

export const listingInputSchema = z.object({
	...listingFields,
	description: listingFields.description.default(""),
	runtime: listingFields.runtime.default("workers-js"),
	platforms: listingFields.platforms.default(["workers"]),
	license: listingFields.license.default(null),
});
export type ListingInput = z.infer<typeof listingInputSchema>;
/** Built from the fields without defaults: Zod 4 applies defaults inside .partial(), which would reset omitted fields. */
export const listingUpdateSchema = z.object(listingFields).partial();
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;

export const listingSearchSchema = z.object({
	q: z.string().trim().max(100).optional(),
	category: z.enum(categorySlugs).optional(),
	runtime: runtimeSchema.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListingSearch = z.infer<typeof listingSearchSchema>;

/** Listing as returned by the API. */
export interface Listing {
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
	state: ListingState;
	owner: { id: string; name: string };
	repoName: string | null;
	/** Tag awaiting review while submitted, and the commit it pointed to at submission. */
	submittedTag: string | null;
	submittedCommit: string | null;
	/** Tag buyers get, set when an admin publishes, pinned to the reviewed commit. */
	publishedTag: string | null;
	publishedCommit: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ListingPage {
	items: Listing[];
	page: number;
	pageSize: number;
	total: number;
}

/** URL slug from a listing name: lowercase ASCII, hyphen-separated, at most 60 characters. */
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

/** One row of a listing's lifecycle history (PRD R12, R18). */
export interface ListingEvent {
	from: ListingState;
	to: ListingState;
	actor: { id: string; name: string; role: TransitionActor };
	tag: string | null;
	commit: string | null;
	note: string | null;
	createdAt: string;
}

/** PRD R24: a published version (the changelog is the list of these, newest first). */
export interface ListingVersion {
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
