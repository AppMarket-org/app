import type { Context } from "hono";

const ORIGIN = "https://appmarket.org";
const STATIC_PATHS = ["/", "/search", "/legal/terms", "/legal/privacy", "/legal/content-policy", "/legal/developer-agreement"];

// SEO: sitemap of static pages plus every published listing and category (listings come from D1 in Phase 1).
export function sitemap(c: Context): Response {
	const urls = STATIC_PATHS.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join("");
	return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, 200, {
		"Content-Type": "application/xml",
	});
}
