// Zod validation schemas. Server-side only: import from "@appmarket/shared/schemas".
// Kept out of the main entry so the browser bundle does not include zod.
import { z } from "zod";
import { CATEGORIES, RUNTIMES, TARGET_PLATFORMS, type CategorySlug, type Runtime } from "./listing";
import { RELEASE_PLATFORMS, type ReleasePlatform } from "./releases";
import { TOKEN_TTL } from "./tokens";

const runtimeKeys = Object.keys(RUNTIMES) as [Runtime, ...Runtime[]];
export const runtimeSchema = z.enum(runtimeKeys);

/** SPDX license identifier, for example MIT or Apache-2.0, or a simple expression such as "MIT OR Apache-2.0". */
export const licenseSchema = z
	.string()
	.trim()
	.max(64)
	.regex(/^[A-Za-z0-9.+-]+( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$/, "Use an SPDX identifier such as MIT or Apache-2.0");

// Catalog categories (PRD R1). Slugs appear in /category/:slug URLs.

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

export const tokenRequestSchema = z
	.object({
		scope: z.enum(["read", "write"]),
		ttl: z.coerce.number().int().min(TOKEN_TTL.min).optional(),
	})
	.refine((r) => r.ttl === undefined || r.ttl <= TOKEN_TTL.max[r.scope], {
		path: ["ttl"],
		message: `At most ${TOKEN_TTL.max.read}s for read and ${TOKEN_TTL.max.write}s for write`,
	});
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

const releasePlatformKeys = Object.keys(RELEASE_PLATFORMS) as [ReleasePlatform, ...ReleasePlatform[]];

/** PRD R13: release upload metadata (query string); the body is the file itself. */
export const releaseUploadSchema = z.object({
	tag: gitTagSchema,
	platform: z.enum(releasePlatformKeys),
	filename: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/, "Use letters, digits, spaces, '.', '_' or '-'")
		.refine((f) => !f.includes(".."), "Not a valid file name"),
	sha256: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[0-9a-f]{64}$/, "SHA-256 as 64 hex characters"),
});
export type ReleaseUpload = z.infer<typeof releaseUploadSchema>;
