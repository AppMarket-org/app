import { CATEGORIES } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import type { Context } from "hono";

const STATIC_PATHS = ["/", "/search", "/legal/terms", "/legal/privacy", "/legal/content-policy", "/legal/developer-agreement"];
/** The sitemap protocol allows 50,000 URLs per file. */
export const SITEMAP_PAGE_SIZE = 50_000;

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function xml(c: Context, body: string): Response {
	return c.body(`<?xml version="1.0" encoding="UTF-8"?>${body}`, 200, {
		"Content-Type": "application/xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
}

function urlset(urls: { loc: string; lastmod?: string }[]): string {
	const items = urls.map((u) => `<url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`).join("");
	return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`;
}

async function publishedListings(offset: number, limit: number): Promise<{ slug: string; updated_at: string }[]> {
	const { results } = await env.DB.prepare("SELECT slug, updated_at FROM listings WHERE state = 'published' ORDER BY created_at, id LIMIT ? OFFSET ?")
		.bind(limit, offset)
		.all<{ slug: string; updated_at: string }>();
	return results;
}

/**
 * SEO (#45): static pages, categories and every published listing with lastmod. Above 50,000 URLs
 * /sitemap.xml becomes an index of /sitemaps/listings-N.xml pages.
 */
export async function sitemap(c: Context): Promise<Response> {
	const origin = env.PUBLIC_ORIGIN;
	const fixed = [...STATIC_PATHS, ...CATEGORIES.map((cat) => `/category/${cat.slug}`)].map((p) => ({ loc: origin + p }));
	const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE state = 'published'").first<{ n: number }>())?.n ?? 0;
	if (fixed.length + count <= SITEMAP_PAGE_SIZE) {
		const listings = await publishedListings(0, SITEMAP_PAGE_SIZE);
		return xml(c, urlset([...fixed, ...listings.map((l) => ({ loc: `${origin}/apps/${l.slug}`, lastmod: l.updated_at }))]));
	}
	const pages = Math.ceil(count / SITEMAP_PAGE_SIZE);
	const entries = [`${origin}/sitemaps/static.xml`, ...Array.from({ length: pages }, (_, i) => `${origin}/sitemaps/listings-${i + 1}.xml`)];
	return xml(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((loc) => `<sitemap><loc>${xmlEscape(loc)}</loc></sitemap>`).join("")}</sitemapindex>`);
}

/** Pages of a sitemap index: /sitemaps/static.xml and /sitemaps/listings-N.xml. */
export async function sitemapPage(c: Context): Promise<Response> {
	const origin = env.PUBLIC_ORIGIN;
	const name = c.req.param("name");
	if (name === "static.xml") return xml(c, urlset([...STATIC_PATHS, ...CATEGORIES.map((cat) => `/category/${cat.slug}`)].map((p) => ({ loc: origin + p }))));
	const page = Number(/^listings-(\d+)\.xml$/.exec(name ?? "")?.[1]);
	if (!Number.isSafeInteger(page) || page < 1) return c.notFound();
	const listings = await publishedListings((page - 1) * SITEMAP_PAGE_SIZE, SITEMAP_PAGE_SIZE);
	if (listings.length === 0) return c.notFound();
	return xml(c, urlset(listings.map((l) => ({ loc: `${origin}/apps/${l.slug}`, lastmod: l.updated_at }))));
}

/**
 * Drops a listing's cached public page in this data center after a lifecycle change. Other data
 * centers expire within the web Worker's cache TTL (5 minutes); a global purge needs the zone purge
 * API (#24).
 */
export async function purgeListingPage(slug: string): Promise<void> {
	await caches.default.delete(new Request(`${env.PUBLIC_ORIGIN}/apps/${slug}`)).catch(() => false);
}
