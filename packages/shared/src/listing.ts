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
	z.object({ to: z.literal("submitted"), tag: gitTagSchema }),
	z.object({ to: z.literal("published"), note: z.string().max(500).optional() }),
	z.object({ to: z.literal("draft") }),
	z.object({ to: z.literal("unpublished"), note: z.string().max(500).optional() }),
	z.object({ to: z.literal("removed"), note: z.string().max(500).optional() }),
]);
export type TransitionRequest = z.infer<typeof transitionSchema>;

// Target platforms (PRD R24, D4, M1-M4).
export type TargetPlatform = "workers" | "pwa" | "android" | "ios" | "download";

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
export const listingInputSchema = z.object({
	name: z.string().trim().min(3).max(80),
	summary: z.string().trim().min(10).max(160),
	description: z.string().trim().max(20_000).default(""),
	category: z.enum(categorySlugs),
});
export type ListingInput = z.infer<typeof listingInputSchema>;
export const listingUpdateSchema = listingInputSchema.partial();
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;

export const listingSearchSchema = z.object({
	q: z.string().trim().max(100).optional(),
	category: z.enum(categorySlugs).optional(),
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
	priceCents: number;
	state: ListingState;
	owner: { id: string; name: string };
	repoName: string | null;
	/** Tag awaiting review while submitted. */
	submittedTag: string | null;
	/** Tag buyers get; set when an admin publishes. */
	publishedTag: string | null;
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
	note: string | null;
	createdAt: string;
}
