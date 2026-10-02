import { z } from "zod";

// Listing lifecycle (PRD R12). A published version pins to a Git tag in the app's Artifacts repo.
export const LISTING_STATES = ["draft", "submitted", "published", "unpublished", "removed"] as const;
export type ListingState = (typeof LISTING_STATES)[number];

const TRANSITIONS: Record<ListingState, readonly ListingState[]> = {
	draft: ["submitted", "removed"],
	submitted: ["draft", "published", "removed"],
	published: ["unpublished", "removed"],
	unpublished: ["submitted", "removed"],
	removed: [],
};

export function canTransition(from: ListingState, to: ListingState): boolean {
	return TRANSITIONS[from].includes(to);
}

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
