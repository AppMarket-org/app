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

async function publishedRepos(offset: number, limit: number): Promise<{ path: string; updated_at: string }[]> {
	const { results } = await env.DB.prepare(
		"SELECT o.handle || '/' || r.slug AS path, r.updated_at FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.state = 'published' ORDER BY r.created_at, r.id LIMIT ? OFFSET ?",
	)
		.bind(limit, offset)
		.all<{ path: string; updated_at: string }>();
	return results;
}

/**
 * SEO (#45): static pages, categories and every published repo with lastmod. Above 50,000 URLs
 * /sitemap.xml becomes an index of /sitemaps/repos-N.xml pages.
 */
export async function sitemap(c: Context): Promise<Response> {
	const origin = env.PUBLIC_ORIGIN;
	const fixed = [...STATIC_PATHS, ...CATEGORIES.map((cat) => `/category/${cat.slug}`)].map((p) => ({ loc: origin + p }));
	const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM repos WHERE state = 'published'").first<{ n: number }>())?.n ?? 0;
	if (fixed.length + count <= SITEMAP_PAGE_SIZE) {
		const repos = await publishedRepos(0, SITEMAP_PAGE_SIZE);
		return xml(c, urlset([...fixed, ...repos.map((l) => ({ loc: `${origin}/${l.path}`, lastmod: l.updated_at }))]));
	}
	const pages = Math.ceil(count / SITEMAP_PAGE_SIZE);
	const entries = [`${origin}/sitemaps/static.xml`, ...Array.from({ length: pages }, (_, i) => `${origin}/sitemaps/repos-${i + 1}.xml`)];
	return xml(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((loc) => `<sitemap><loc>${xmlEscape(loc)}</loc></sitemap>`).join("")}</sitemapindex>`);
}

/** Pages of a sitemap index: /sitemaps/static.xml and /sitemaps/repos-N.xml. */
export async function sitemapPage(c: Context): Promise<Response> {
	const origin = env.PUBLIC_ORIGIN;
	const name = c.req.param("name");
	if (name === "static.xml") return xml(c, urlset([...STATIC_PATHS, ...CATEGORIES.map((cat) => `/category/${cat.slug}`)].map((p) => ({ loc: origin + p }))));
	const page = Number(/^repos-(\d+)\.xml$/.exec(name ?? "")?.[1]);
	if (!Number.isSafeInteger(page) || page < 1) return c.notFound();
	const repos = await publishedRepos((page - 1) * SITEMAP_PAGE_SIZE, SITEMAP_PAGE_SIZE);
	if (repos.length === 0) return c.notFound();
	return xml(c, urlset(repos.map((l) => ({ loc: `${origin}/${l.path}`, lastmod: l.updated_at }))));
}

/**
 * Drops a repo's cached public page in this data center after a lifecycle change. Other data
 * centers expire within the web Worker's cache TTL (5 minutes); a global purge needs the zone purge
 * API (#24).
 */
/** #146: a profile changed (fields, picture, pins, privacy): drop its cached page. */
export async function purgeOwnerPage(handle: string): Promise<void> {
	await caches.default.delete(new Request(`${env.PUBLIC_ORIGIN}/${handle}`)).catch(() => false);
}

export async function purgeRepoPage(fullName: string): Promise<void> {
	await caches.default.delete(new Request(`${env.PUBLIC_ORIGIN}/${fullName}`)).catch(() => false);
}
