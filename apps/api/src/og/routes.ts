import { CATEGORIES, RUNTIMES } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { logEvent } from "../observability/log.ts";
import { RepoStore } from "../repos/repository.ts";
import type { CardContent } from "./card.ts";
import { renderCard } from "./render.ts";

/** Bump when the card design changes so stored cards are regenerated. */
const DESIGN = 2;

async function serveCard(c: Context, content: CardContent): Promise<Response> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([DESIGN, content]))));
	const key = `og/${[...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}.png`;
	const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, s-maxage=604800" };
	const stored = await env.MEDIA.get(key);
	if (stored) return new Response(stored.body, { headers });
	const png = await renderCard(content);
	c.executionCtx.waitUntil(env.MEDIA.put(key, png, { httpMetadata: { contentType: "image/png" } }));
	logEvent("og.rendered", { key, bytes: png.length });
	return new Response(png, { headers });
}

const SITE: CardContent = {
	title: "A Git platform",
	highlight: "for agents and humans.",
	subtitle: "Every commit keeps its prompt, model and context. Deploy apps to your own Cloudflare.",
	tags: ["Checkpoints", "Agent memory", "A2A"],
};

/** Social preview cards (1200×630 PNG) for published apps, categories and the home page. Mounted under /api/og. */
export const ogRoutes = new Hono()
	.get("/home.png", (c) => serveCard(c, SITE))
	.get("/category/:file{[a-z-]+\\.png}", (c) => {
		const category = CATEGORIES.find((k) => `${k.slug}.png` === c.req.param("file"));
		return category ? serveCard(c, { title: category.name, subtitle: `${category.name} apps on appmarket.org. Deploy them into your own Cloudflare account.`, tags: ["Category"] }) : c.notFound();
	})
	.get("/:owner/:file{[^/]+\\.png}", async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("file").replace(/\.png$/, ""));
		// Only public apps get cards; drafts never leak through a guessable URL.
		if (!repo || repo.state !== "published") return c.notFound();
		return serveCard(c, {
			title: repo.name,
			subtitle: repo.summary,
			tags: [repo.fullName, CATEGORIES.find((k) => k.slug === repo.category)?.name ?? "", RUNTIMES[repo.runtime]?.name ?? ""],
		});
	});
