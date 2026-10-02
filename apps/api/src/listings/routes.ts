import {
	TOKEN_TTL,
	canTransition,
	listingInputSchema,
	listingSearchSchema,
	listingUpdateSchema,
	tokenRequestSchema,
	transitionSchema,
	type Listing,
	type RepoToken,
	type Role,
	type TransitionActor,
} from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { createListingRepo, deleteListingRepo, mintRepoToken, repoNameFor, resolveTag } from "../artifacts/repos.ts";
import { ListingRepository } from "./repository.ts";
import { tokenPolicy } from "./token-policy.ts";

const listings = () => new ListingRepository(env.DB);

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
		if (!listing || !canView(listing, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return c.json(listing);
	})
	.post("/", requireRole(), async (c) => {
		const input = listingInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json(invalid(input.error), 400);
		const user = c.get("session")!.user;
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
		// PRD R2: a submitted tag must exist in the listing's repo; record the commit it points to.
		let commit: string | null = null;
		if (request.data.to === "submitted") {
			if (!listing.repoName) return c.json({ error: "no_repo" }, 409);
			commit = await resolveTag(listing.repoName, request.data.tag);
			if (!commit) return c.json({ error: "tag_not_found", tag: request.data.tag }, 422);
		}
		if (!(await repo.transition(listing, request.data, { id: session.user.id, role: actor }, commit))) {
			return c.json({ error: "conflict", message: "Listing changed; reload and retry." }, 409);
		}
		return c.json(await repo.findBySlug(listing.slug));
	})
	// PRD R3: short-lived, repo-scoped Git tokens. Write for the owner only; read once published.
	.post("/:slug/tokens", requireRole(), async (c) => {
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
		await env.DB.prepare("INSERT INTO token_audit (listing_id, user_id, scope, expires_at, token_id) VALUES (?, ?, ?, ?, ?)")
			.bind(listing.id, user.id, request.data.scope, minted.expiresAt, tokenId)
			.run();
		c.header("Cache-Control", "no-store");
		return c.json({ scope: request.data.scope, ...minted } satisfies RepoToken, 201);
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

function canEdit(listing: Listing, session: SessionLike): boolean {
	return !!session && (session.user.id === listing.owner.id || session.user.role === "admin");
}

function canView(listing: Listing, session: SessionLike): boolean {
	return listing.state === "published" || canEdit(listing, session);
}
