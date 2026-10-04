// Zod validation schemas. Server-side only: import from "@appmarket/shared/schemas".
// Kept out of the main entry so the browser bundle does not include zod.
import { z } from "zod";
import { CATEGORIES, REPO_SORTS, RUNTIMES, TARGET_PLATFORMS, type CategorySlug, type Runtime } from "./repo";
import { RELEASE_PLATFORMS, type ReleasePlatform } from "./releases";
import { REPORT_REASONS, type ReportReason } from "./reports";
import { TOKEN_TTL } from "./tokens";
import { CHECKPOINT_LIMITS, CHECKPOINT_SCHEMA, CHECKPOINT_VISIBILITIES, EFFORT_LEVELS, HARNESSES } from "./checkpoints";
import { WORKER_NAME_PATTERN } from "./deployments";
import { ORG_ROLES, handleProblem } from "./owners";

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

/** Fields a developer sets when creating or editing a repo (PRD R1). Price is free-only in Phase 1 (R17). */
const repoFields = {
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

export const repoInputSchema = z.object({
	...repoFields,
	/** Handle of the user or org to create it under; defaults to the signed-in user. */
	owner: z.string().trim().toLowerCase().max(39).optional(),
	description: repoFields.description.default(""),
	runtime: repoFields.runtime.default("workers-js"),
	platforms: repoFields.platforms.default(["workers"]),
	license: repoFields.license.default(null),
});
export type RepoInput = z.infer<typeof repoInputSchema>;
/** Built from the fields without defaults: Zod 4 applies defaults inside .partial(), which would reset omitted fields. */
export const repoUpdateSchema = z.object(repoFields).partial();
export type RepoUpdate = z.infer<typeof repoUpdateSchema>;

export const repoSearchSchema = z.object({
	q: z.string().trim().max(100).optional(),
	category: z.enum(categorySlugs).optional(),
	runtime: runtimeSchema.optional(),
	sort: z.enum(REPO_SORTS).default("newest"),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type RepoSearch = z.infer<typeof repoSearchSchema>;

/** A Git tag name we accept for a submitted version: a safe subset of git's ref rules. */
export const gitTagSchema = z
	.string()
	.trim()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, "Use letters, digits, '.', '_', '-' or '/'")
	.refine((t) => !t.includes("..") && !t.endsWith(".lock") && !t.endsWith("/") && !t.endsWith("."), "Not a valid Git tag name");

export const transitionSchema = z.discriminatedUnion("to", [
	z.object({ to: z.literal("submitted"), tag: gitTagSchema, releaseNotes: z.string().trim().max(10_000).default("") }),
	z.object({ to: z.literal("published"), note: z.string().max(500).optional() }),
	// Owners withdraw; admins request changes, which needs a note (enforced by the API).
	z.object({ to: z.literal("draft"), note: z.string().trim().max(500).optional() }),
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

/** PRD R18: a visitor's report about a repo. */
export const reportInputSchema = z.object({
	reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
	details: z.string().trim().min(10).max(5000),
	contact: z.string().trim().email().max(200).nullable().default(null),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

/** PRD D6: start a deploy. Secret values go to the buyer's Worker and are not kept after the deploy. */
export const deploymentRequestSchema = z.object({
	accountId: z.string().regex(/^[a-f0-9]{32}$/, "Not a Cloudflare account ID"),
	workerName: z.string().regex(WORKER_NAME_PATTERN, "Use lowercase letters, numbers and dashes (up to 63)"),
	secrets: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().min(1).max(5120)).default({}),
});
export type DeploymentRequest = z.infer<typeof deploymentRequestSchema>;

/** #102: a user or organization handle. */
export const handleSchema = z
	.string()
	.trim()
	.toLowerCase()
	.superRefine((h, ctx) => {
		const problem = handleProblem(h);
		if (problem) ctx.addIssue({ code: "custom", message: problem });
	});

export const orgCreateSchema = z.object({ handle: handleSchema, name: z.string().trim().min(1).max(80) });
export type OrgCreate = z.infer<typeof orgCreateSchema>;

/** #139: "" and null clear a field; the website must be an https URL. */
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max, `At most ${max} characters.`)
		.nullable()
		.optional()
		.transform((v) => (v === "" ? null : v));
export const profileUpdateSchema = z
	.object({
		name: optionalText(80),
		bio: optionalText(160),
		location: optionalText(80),
		website: optionalText(200).refine((v) => v == null || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v), "Use a full https:// address."),
	})
	.strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const orgMemberSchema = z.object({ handle: z.string().trim().toLowerCase().min(1).max(39), role: z.enum(ORG_ROLES).default("member") });
export type OrgMemberInput = z.infer<typeof orgMemberSchema>;

/** Checkpoints PRD: the record a CLI uploads. Strings are capped; arrays are truncated by the CLI before upload. */
const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, "Full commit SHA");
const iso = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
export const checkpointRecordSchema = z.object({
	schema: z.literal(CHECKPOINT_SCHEMA),
	commit: sha,
	parents: z.array(sha).max(16),
	branch: z.string().max(255),
	author: z.object({ name: z.string().max(255), email: z.string().max(320) }),
	harness: z.enum(HARNESSES),
	harness_version: z.string().max(64),
	session_id: z.string().max(128),
	model: z.string().max(128),
	effort: z.object({ raw: z.string().max(64), level: z.enum(EFFORT_LEVELS) }),
	effort_metrics: z.object({ turns: count, wall_clock_s: count, tool_calls: count, retries: count, reasoning_tokens: count.nullable() }),
	prompts: z.array(z.object({ ts: iso, text: z.string().max(100_000) })).max(CHECKPOINT_LIMITS.prompts),
	assistant_summary: z.string().max(CHECKPOINT_LIMITS.assistantSummaryChars),
	tools: z.array(z.object({ name: z.string().max(128), args_summary: z.string().max(1024), outcome: z.enum(["ok", "error"]), ts: iso })).max(CHECKPOINT_LIMITS.tools),
	usage: z.object({
		input_tokens: count.nullable(),
		output_tokens: count.nullable(),
		cost_usd: z.number().nonnegative().nullable(),
		cache_read_tokens: count.nullable().optional(),
		cache_write_tokens: count.nullable().optional(),
		// Set by appmarket.org only; an upload cannot claim it.
		cost_priced: z.undefined().optional(),
	}),
	files: z.array(z.object({ path: z.string().max(1024), added: count, removed: count })).max(CHECKPOINT_LIMITS.files),
	redactions: count,
	source: z.enum(["harness", "agent-reported"]),
	created_at: iso,
	rewritten_from: sha.optional(),
	truncated: z.boolean().optional(),
});

/** Owner edits: visibility, or a prompt added after the fact (`appmarket record --for <sha>`). */
export const checkpointPatchSchema = z
	.object({ visibility: z.enum(CHECKPOINT_VISIBILITIES).optional(), add_prompt: z.string().trim().min(1).max(100_000).optional() })
	.refine((p) => p.visibility || p.add_prompt, "Nothing to change");
/** Repo default for new checkpoints, or one visibility for every checkpoint of a session. */
export const checkpointVisibilitySchema = z.object({ visibility: z.enum(CHECKPOINT_VISIBILITIES) });
export const sessionVisibilitySchema = z.object({ session: z.string().min(1).max(128), visibility: z.enum(CHECKPOINT_VISIBILITIES) });

export type CheckpointUpload = z.infer<typeof checkpointRecordSchema>;
export type CheckpointPatch = z.infer<typeof checkpointPatchSchema>;
