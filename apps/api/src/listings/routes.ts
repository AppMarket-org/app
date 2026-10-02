import { listingInputSchema, listingSearchSchema, listingUpdateSchema, type Listing } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { ListingRepository } from "./repository.ts";

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
		return c.json(await listings().create(user.id, input.data), 201);
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
	});

type SessionLike = AuthVariables["session"];

function canEdit(listing: Listing, session: SessionLike): boolean {
	return !!session && (session.user.id === listing.owner.id || session.user.role === "admin");
}

function canView(listing: Listing, session: SessionLike): boolean {
	return listing.state === "published" || canEdit(listing, session);
}
