import { MAX_LISTINGS_PER_DEVELOPER, SCREENSHOT_LIMITS, TOKEN_TTL, canTransition, type Listing, type RepoToken, type Role, type TransitionActor } from "@appmarket/shared";
import { listingInputSchema, listingSearchSchema, listingUpdateSchema, tokenRequestSchema, transitionSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { rateLimit } from "../rate-limit.ts";
import {
	createListingRepo,
	deleteListingRepo,
	listRepoTokens,
	mintRepoToken,
	readFiles,
	readReadme,
	readRootEntries,
	repoRemote,
	repoNameFor,
	resolveTag,
	revokeAllRepoTokens,
	revokeRepoToken,
} from "../artifacts/repos.ts";
import { purgeListingPage } from "../routes/seo.ts";
import { canEdit, canView } from "./access.ts";
import { CONTRACT_FILES, checkTemplate } from "@appmarket/template-contract";
import { type ListingCheckSummary, ListingRepository } from "./repository.ts";
import { checkRuntime } from "./runtime-check.ts";
import { Screenshots } from "./screenshots.ts";
import { TokenAudit } from "./token-audit.ts";
import { tokenPolicy } from "./token-policy.ts";

const listings = () => new ListingRepository(env.DB);
const tokenAudit = () => new TokenAudit(env.DB);
const screenshots = () => new Screenshots(env.DB, env.MEDIA);

type Ctx = { Variables: AuthVariables };
const perUser = (c: Context<Ctx>) => c.get("session")!.user.id;
const limitListingCreate = rateLimit<Ctx>(() => env.RL_LISTING_CREATE, perUser, env.RATE_LIMIT_CONFIG.LISTING_CREATE.period);
const limitTokens = rateLimit<Ctx>(() => env.RL_TOKENS, perUser, env.RATE_LIMIT_CONFIG.TOKENS.period);

function invalid(error: z.ZodError) {
	return { error: "invalid", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** PRD R1: catalog. Public reads see published listings; owners and admins see their own in any state. */
export const listingRoutes = new Hono<{ Variables: AuthVariables }>()
	.get("/", async (c) => {
		const search = listingSearchSchema.safeParse(c.req.query());
		if (!search.success) return c.json(invalid(search.error), 400);
		return c.json(await listings().search(search.data));
	})
	.get("/mine", requireRole(), async (c) => {
		return c.json({ items: await listings().listByOwner(c.get("session")!.user.id) });
	})
	.get("/:slug", async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		// SEO: a removed listing is gone for good, so crawlers drop it (410), unlike a hidden one (404).
		if (listing?.state === "removed" && !canEdit(listing, c.get("session"))) return c.json({ error: "gone" }, 410);
		if (!listing || !canView(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json(listing);
	})
	.post("/", requireRole(), limitListingCreate, async (c) => {
		const input = listingInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json(invalid(input.error), 400);
		const user = c.get("session")!.user;
		// PRD R19: per-developer quota on listings that are not removed. Admins are exempt.
		if (user.role !== "admin" && (await listings().countActiveByOwner(user.id)) >= MAX_LISTINGS_PER_DEVELOPER) {
			return c.json({ error: "quota_exceeded", limit: MAX_LISTINGS_PER_DEVELOPER }, 409);
		}
		// Creating a first listing makes a buyer a developer (PRD R11 roles).
		if (user.role === "buyer") {
			await env.DB.prepare(`UPDATE "user" SET role = 'developer' WHERE id = ? AND role = 'buyer'`).bind(user.id).run();
		}
		// PRD R2: create the listing's Artifacts repo first; undo it if the listing cannot be saved.
		const repo = listings();
		const ids = await repo.reserve(input.data.name);
		const repoName = repoNameFor(ids.slug, ids.id);
		await createListingRepo(repoName);
		try {
			return c.json(await repo.insert(ids, user.id, input.data, repoName), 201);
		} catch (error) {
			await deleteListingRepo(repoName).catch(() => undefined);
			if (String(error).includes("UNIQUE")) return c.json({ error: "conflict", message: "Name just taken; retry." }, 409);
			throw error;
		}
	})
	.patch("/:slug", requireRole(), async (c) => {
		const repo = listings();
		const listing = await repo.findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canView(listing, session)) return c.json({ error: "not_found" }, 404);
		if (!canEdit(listing, session)) return c.json({ error: "forbidden" }, 403);
		if (listing.state === "removed") return c.json({ error: "removed" }, 409);
		const update = listingUpdateSchema.safeParse(await c.req.json().catch(() => null));
		if (!update.success) return c.json(invalid(update.error), 400);
		await repo.update(listing.id, update.data);
		if (listing.state === "published") c.executionCtx.waitUntil(purgeListingPage(listing.slug));
		return c.json(await repo.findBySlug(listing.slug));
	})
	// PRD R12: lifecycle. Owners submit a tag, withdraw, unpublish or remove; admins publish (approve).
	.post("/:slug/transitions", requireRole(), async (c) => {
		const repo = listings();
		const listing = await repo.findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canView(listing, session)) return c.json({ error: "not_found" }, 404);
		const request = transitionSchema.safeParse(await c.req.json().catch(() => null));
		if (!request.success) return c.json(invalid(request.error), 400);
		const actor = actorFor(listing, session, request.data.to);
		if (!actor) {
			return c.json({ error: "transition_not_allowed", from: listing.state, to: request.data.to }, canEdit(listing, session) ? 409 : 403);
		}
		// R18: an admin sending a submission back must say what to change.
		if (request.data.to === "draft" && actor === "admin" && !request.data.note) {
			return c.json({ error: "note_required", message: "Tell the owner what to change." }, 400);
		}
		// PRD R2: a submitted tag must exist in the listing's repo; record the commit it points to.
		let commit: string | null = null;
		let checks: ListingCheckSummary | null = null;
		if (request.data.to === "submitted") {
			if (!listing.repoName) return c.json({ error: "no_repo" }, 409);
			commit = await resolveTag(listing.repoName, request.data.tag);
			if (!commit) return c.json({ error: "tag_not_found", tag: request.data.tag }, 422);
			// R26: the version must look like the declared runtime.
			const root = await readRootEntries(listing.repoName, commit);
			const issues = checkRuntime(listing.runtime, root);
			if (issues.length > 0) return c.json({ error: "runtime_mismatch", runtime: listing.runtime, issues }, 422);
			// D2/G4: template contract; errors block, warnings and the D3 manifest go to review.
			const contract = checkTemplate({ runtime: listing.runtime, rootEntries: root.map((e) => e.name), files: await readFiles(listing.repoName, commit, CONTRACT_FILES) });
			if (contract.errors.length > 0) return c.json({ error: "contract_failed", errors: contract.errors, warnings: contract.warnings }, 422);
			checks = { warnings: contract.warnings, manifest: contract.manifest };
		}
		if (!(await repo.transition(listing, request.data, { id: session.user.id, role: actor }, commit, checks))) {
			return c.json({ error: "conflict", message: "Listing changed; reload and retry." }, 409);
		}
		if (["published", "unpublished", "removed"].includes(request.data.to)) c.executionCtx.waitUntil(purgeListingPage(listing.slug));
		// PRD R19: archiving a removed listing revokes every active token; no new ones are issued (token policy).
		if (request.data.to === "removed" && listing.repoName) {
			await tokenAudit().recordRevocations(listing.id, await revokeAllRepoTokens(listing.repoName), session.user.id);
		}
		return c.json(await repo.findBySlug(listing.slug));
	})
	// PRD R3: short-lived, repo-scoped Git tokens. Write for the owner only; read once published.
	.post("/:slug/tokens", requireRole(), limitTokens, async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const user = c.get("session")!.user;
		if (!listing) return c.json({ error: "not_found" }, 404);
		const request = tokenRequestSchema.safeParse(await c.req.json().catch(() => ({})));
		if (!request.success) return c.json(invalid(request.error), 400);
		const decision = tokenPolicy(listing, { id: user.id, role: user.role as Role }, request.data.scope);
		if (!decision.allowed) return c.json({ error: decision.error }, decision.status);

		const ttl = request.data.ttl ?? TOKEN_TTL.default;
		const { id: tokenId, ...minted } = await mintRepoToken(listing.repoName!, request.data.scope, ttl);
		// R19: audit every mint with the token id, never the token itself.
		await tokenAudit().recordMint({ listingId: listing.id, userId: user.id, tokenId, scope: request.data.scope, expiresAt: minted.expiresAt });
		c.header("Cache-Control", "no-store");
		return c.json({ scope: request.data.scope, ...minted } satisfies RepoToken, 201);
	})
	// PRD R19: owners and admins see every token minted for the listing and can revoke them.
	.get("/:slug/tokens", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		if (!listing || !canEdit(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const live = listing.repoName ? await listRepoTokens(listing.repoName) : [];
		return c.json({ items: await tokenAudit().list(listing.id, live) });
	})
	.delete("/:slug/tokens/:tokenId", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canEdit(listing, session) || !listing.repoName) return c.json({ error: "not_found" }, 404);
		const tokenId = c.req.param("tokenId");
		// Only tokens appmarket.org minted for this listing can be revoked through it.
		if (!(await tokenAudit().isAudited(listing.id, tokenId))) return c.json({ error: "not_found" }, 404);
		const revoked = await revokeRepoToken(listing.repoName, tokenId);
		await tokenAudit().recordRevocations(listing.id, [tokenId], session.user.id);
		return c.json({ revoked });
	})
	.post("/:slug/tokens/revoke-all", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canEdit(listing, session) || !listing.repoName) return c.json({ error: "not_found" }, 404);
		const ids = await revokeAllRepoTokens(listing.repoName);
		await tokenAudit().recordRevocations(listing.id, ids, session.user.id);
		return c.json({ revoked: ids.length });
	})
	// R16: Git remote for the owner's dashboard (no credentials in it).
	.get("/:slug/repo", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		if (!listing || !canEdit(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		if (!listing.repoName) return c.json({ error: "no_repo" }, 409);
		return c.json({ name: listing.repoName, remote: await repoRemote(listing.repoName) });
	})
	// R24: changelog (published versions) and README of the published commit.
	.get("/:slug/versions", async (c) => {
		const repo = listings();
		const listing = await repo.findBySlug(c.req.param("slug"));
		if (!listing || !canView(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await repo.versions(listing.id) });
	})
	.get("/:slug/readme", async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const session = c.get("session");
		if (!listing || !canView(listing, session)) return c.json({ error: "not_found" }, 404);
		// Buyers see the published commit; the owner and admins can preview the submitted one.
		const commit = c.req.query("version") === "submitted" && canEdit(listing, session) ? listing.submittedCommit : listing.publishedCommit;
		const markdown = listing.repoName && commit ? await readReadme(listing.repoName, commit) : null;
		if (markdown === null) return c.json({ error: "no_readme" }, 404);
		c.header("Cache-Control", listing.state === "published" ? "public, max-age=300" : "private, no-store");
		return c.json({ commit, markdown });
	})
	// R24: screenshots (owner manages; visible wherever the listing is).
	.get("/:slug/screenshots", async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		if (!listing || !canView(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await screenshots().list(listing.id) });
	})
	.post("/:slug/screenshots", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canView(listing, session)) return c.json({ error: "not_found" }, 404);
		if (!canEdit(listing, session)) return c.json({ error: "forbidden" }, 403);
		const declared = Number(c.req.header("content-length") ?? "0");
		if (declared > SCREENSHOT_LIMITS.maxBytes) return c.json({ error: "too_large", maxBytes: SCREENSHOT_LIMITS.maxBytes }, 413);
		const result = await screenshots().add(listing.id, await c.req.arrayBuffer());
		if (result.ok && listing.state === "published") c.executionCtx.waitUntil(purgeListingPage(listing.slug));
		return result.ok ? c.json(result.screenshot, 201) : c.json({ error: result.error }, result.status);
	})
	.delete("/:slug/screenshots/:id", requireRole(), async (c) => {
		const listing = await listings().findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canEdit(listing, session)) return c.json({ error: "not_found" }, 404);
		return (await screenshots().remove(listing.id, c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	})
	.get("/:slug/events", requireRole(), async (c) => {
		const repo = listings();
		const listing = await repo.findBySlug(c.req.param("slug"));
		const session = c.get("session")!;
		if (!listing || !canEdit(listing, session)) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await repo.events(listing.id) });
	});

/** PRD R18: moderation queue. Mounted under /api/admin. */
export const adminListingRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireRole("admin"))
	.get("/listings", async (c) => {
		const state = c.req.query("state") ?? "submitted";
		if (!["draft", "submitted", "published", "unpublished", "removed"].includes(state)) return c.json({ error: "invalid_state" }, 400);
		return c.json({ items: await listings().listByState(state as Listing["state"]) });
	});

type SessionLike = AuthVariables["session"];

/** The role this user acts in for a transition, or null if they may not make it. Owners act as owners first. */
function actorFor(listing: Listing, session: NonNullable<SessionLike>, to: Listing["state"]): TransitionActor | null {
	const roles: TransitionActor[] = [];
	if (session.user.id === listing.owner.id) roles.push("owner");
	if (session.user.role === "admin") roles.push("admin");
	return roles.find((role) => canTransition(listing.state, to, role)) ?? null;
}


/** R24: serves screenshot bytes. Mounted at /api/media. Unpublished listings' images stay private. */
export const mediaRoutes = new Hono<{ Variables: AuthVariables }>().get("/screenshots/:id", async (c) => {
	const store = screenshots();
	const row = await store.find(c.req.param("id"));
	const listing = row && (await listings().findById(row.listing_id));
	if (!row || !listing || !canView(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
	const object = await store.object(row);
	if (!object) return c.json({ error: "not_found" }, 404);
	return c.body(object.body, 200, {
		"Content-Type": row.content_type,
		"Cache-Control": listing.state === "published" ? "public, max-age=86400" : "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'",
	});
});
