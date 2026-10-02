import { RenderMode, ServerRoute } from '@angular/ssr';

// Hybrid rendering: SEO pages get full HTML from the server; app pages render in the browser.
export const serverRoutes: ServerRoute[] = [
  // Home lists the latest apps, so it renders per request.
  { path: '', renderMode: RenderMode.Server },
  // Static content: prerendered at build time.
  {
    path: 'legal/:page',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => ['terms', 'developer-agreement', 'content-policy', 'privacy'].map((page) => ({ page })),
  },
  // Catalog pages: rendered per request from D1 data so new listings are indexable immediately.
  { path: 'apps/:slug', renderMode: RenderMode.Server },
  { path: 'category/:slug', renderMode: RenderMode.Server },
  { path: 'search', renderMode: RenderMode.Server },
  // Signed-in app: single-page app, not indexed.
  { path: 'login', renderMode: RenderMode.Client },
  { path: 'dashboard/new', renderMode: RenderMode.Client },
  { path: 'dashboard/listings/:slug', renderMode: RenderMode.Client },
  { path: 'dashboard/cloudflare', renderMode: RenderMode.Client },
  { path: 'dashboard', renderMode: RenderMode.Client },
  { path: 'admin', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
