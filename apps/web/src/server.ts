import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

const angularApp = new AngularAppEngine({
	// localhost is safe to allow: in production Cloudflare never routes it as the host.
	allowedHosts: ['localhost', 'appmarket.org', 'www.appmarket.org'],
});

const API_PATHS = /^\/(api\/|sitemap\.xml$)/;

/**
 * Request handler used by the Angular CLI (dev-server and build) and as the Worker entry.
 * API and sitemap requests go to the API Worker; everything else is rendered by Angular
 * per the render modes in app.routes.server.ts.
 */
export const reqHandler = createRequestHandler(async (req) => {
	return (await angularApp.handle(req)) ?? new Response('Page not found.', { status: 404 });
});

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (API_PATHS.test(pathname)) {
			return env.API.fetch(request);
		}
		// SSR data requests reach the API over the service binding (see app/api/server-api.ts).
		const context = { apiFetch: (apiRequest: Request) => env.API.fetch(apiRequest) };
		return (await angularApp.handle(request, context)) ?? new Response('Page not found.', { status: 404 });
	},
};
