import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

const angularApp = new AngularAppEngine({
	// localhost is safe to allow: in production Cloudflare never routes it as the host.
	allowedHosts: ['localhost', 'appmarket.org', 'www.appmarket.org', 'staging.appmarket.org'],
});

const API_PATHS = /^\/(api\/|sitemap\.xml$|sitemaps\/)/;

/**
 * Public catalog pages cached at the edge for anonymous visitors (#45): home, categories, search,
 * and owner and repo pages (/:owner, /:owner/:repo, #102). Site paths are reserved handles.
 */
const CACHEABLE = /^\/($|category\/[^/]+$|search$|(?!(?:dashboard|settings|admin|login|legal|api|apps|sitemaps)(?:\/|$))[^/.]+(?:\/[^/.]+)?$)/;
/** Links from before #102: /apps/:slug. */
const LEGACY_APP = /^\/apps\/([^/]+)$/;
const CACHE_SECONDS = 300;

/**
 * Request handler used by the Angular CLI (dev-server and build) and as the Worker entry.
 * API and sitemap requests go to the API Worker; everything else is rendered by Angular
 * per the render modes in app.routes.server.ts.
 */
export const reqHandler = createRequestHandler(async (req) => {
	return (await angularApp.handle(req)) ?? new Response('Page not found.', { status: 404 });
});

/** Only the production hosts are indexed; staging and local hosts say noindex everywhere. */
const INDEXED_HOSTS = new Set(['appmarket.org', 'www.appmarket.org']);

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (INDEXED_HOSTS.has(new URL(request.url).hostname)) return serve(request, env, ctx);
		if (new URL(request.url).pathname === '/robots.txt') {
			return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
		}
		return withHeaders(await serve(request, env, ctx), { 'X-Robots-Tag': 'noindex, nofollow' });
	},
};

async function serve(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const { pathname } = new URL(request.url);
	if (API_PATHS.test(pathname)) {
		return env.API.fetch(request);
	}
	// Old /apps/:slug links move permanently to /:owner/:slug.
	const legacy = LEGACY_APP.exec(pathname);
	if (legacy) {
		const found = await env.API.fetch(new Request(new URL(`/api/legacy/apps/${legacy[1]}`, request.url)));
		if (found.ok) {
			const { fullName } = (await found.json()) as { fullName: string };
			return Response.redirect(new URL(`/${fullName}${new URL(request.url).search}`, request.url).toString(), 301);
		}
	}
	// SSR data requests reach the API over the service binding (see app/api/server-api.ts).
	const context = { apiFetch: (apiRequest: Request) => env.API.fetch(apiRequest) };
	const render = async () => (await angularApp.handle(request, context)) ?? new Response('Page not found.', { status: 404 });

	// Anonymous GETs of catalog pages are cached; anything with a cookie (a signed-in visitor, who
	// may see drafts) is rendered fresh and never stored.
	const url = new URL(request.url);
	const anonymous = request.method === 'GET' && !request.headers.has('cookie') && CACHEABLE.test(url.pathname);
	if (!anonymous) {
		const response = await render();
		if (CACHEABLE.test(url.pathname)) return withHeaders(response, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
		return response;
	}
	// Workers' default cache; the DOM CacheStorage type Angular compiles against does not declare it.
	const cache = (caches as unknown as { default: Cache }).default;
	const key = new Request(url.toString(), { method: 'GET' });
	const hit = await cache.match(key);
	if (hit) return withHeaders(hit, { 'X-Cache': 'HIT' });
	const response = withHeaders(await render(), { 'Cache-Control': `public, max-age=60, s-maxage=${CACHE_SECONDS}`, Vary: 'Cookie' });
	if (response.status === 200) ctx.waitUntil(cache.put(key, response.clone()));
	return withHeaders(response, { 'X-Cache': 'MISS' });
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
	const copy = new Response(response.body, response);
	for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
	return copy;
}
