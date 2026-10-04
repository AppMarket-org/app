import { AVATAR_LIMITS } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { sniffImageType } from "../repos/images.ts";
import { OwnerStore } from "./store.ts";

const key = (ownerId: string, avatarId: string) => `avatars/${ownerId}/${avatarId}`;

/**
 * #140: stores a new picture for an owner (PNG, JPEG or WebP by its bytes, up to 2 MB) and drops
 * the previous one. The browser crops it to a square before upload.
 */
export async function replaceAvatar(c: Context<{ Variables: AuthVariables }>, ownerId: string): Promise<Response> {
	const length = Number(c.req.header("content-length") ?? "0");
	if (length > AVATAR_LIMITS.maxBytes) return c.json({ error: "too_large", maxBytes: AVATAR_LIMITS.maxBytes }, 413);
	const body = await c.req.arrayBuffer();
	if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
	if (body.byteLength > AVATAR_LIMITS.maxBytes) return c.json({ error: "too_large", maxBytes: AVATAR_LIMITS.maxBytes }, 413);
	const contentType = sniffImageType(new Uint8Array(body, 0, Math.min(16, body.byteLength)));
	if (!contentType) return c.json({ error: "unsupported_image", allowed: AVATAR_LIMITS.types }, 415);
	const id = crypto.randomUUID();
	await env.MEDIA.put(key(ownerId, id), body, { httpMetadata: { contentType } });
	const store = new OwnerStore(env.DB);
	const previous = await store.setAvatar(ownerId, { id, contentType });
	if (previous) await env.MEDIA.delete(key(ownerId, previous));
	logEvent("avatar.changed", { owner: ownerId });
	return c.json({ owner: await store.byId(ownerId) });
}

export async function removeAvatar(c: Context<{ Variables: AuthVariables }>, ownerId: string): Promise<Response> {
	const store = new OwnerStore(env.DB);
	const previous = await store.setAvatar(ownerId, null);
	if (previous) await env.MEDIA.delete(key(ownerId, previous));
	return c.json({ owner: await store.byId(ownerId) });
}

/** Serves pictures. Mounted at /api/media. An id is never reused, so responses cache for a year. */
export const avatarMediaRoutes = new Hono<{ Variables: AuthVariables }>().get("/avatars/:id", async (c) => {
	const id = c.req.param("id");
	if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "not_found" }, 404);
	const avatar = await new OwnerStore(env.DB).avatar(id);
	const object = avatar && (await env.MEDIA.get(key(avatar.ownerId, id)));
	if (!avatar || !object) return c.json({ error: "not_found" }, 404);
	return c.body(object.body, 200, {
		// The type recorded at upload (sniffed from the bytes), never anything that can run.
		"Content-Type": avatar.contentType,
		"Cache-Control": "public, max-age=31536000, immutable",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'",
		"Content-Disposition": "inline",
	});
});
