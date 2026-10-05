import { RenderMode, ServerRoute } from '@angular/ssr';

// Hybrid rendering: SEO pages get full HTML from the server; app pages render in the browser.
export const serverRoutes: ServerRoute[] = [
  // Home lists the latest apps, so it renders per request.
  { path: '', renderMode: RenderMode.Server },
  // Static content: prerendered at build time.
  { path: 'email/unsubscribe', renderMode: RenderMode.Client },
  {
    path: 'legal/:page',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => ['terms', 'developer-agreement', 'content-policy', 'privacy'].map((page) => ({ page })),
  },
  // Catalog pages: rendered per request from D1 data so new repos are indexable immediately.
  { path: 'category/:slug', renderMode: RenderMode.Server },
  { path: 'search', renderMode: RenderMode.Server },
  // Signed-in app: single-page app, not indexed.
  { path: 'login', renderMode: RenderMode.Client },
  { path: 'dashboard/new', renderMode: RenderMode.Client },
  { path: 'device', renderMode: RenderMode.Client },
  { path: 'settings/orgs/new', renderMode: RenderMode.Client },
  { path: 'settings/orgs/:handle', renderMode: RenderMode.Client },
  { path: 'settings', renderMode: RenderMode.Client },
  { path: 'dashboard/repos/:owner/:slug/agents', renderMode: RenderMode.Client },
  { path: 'dashboard/repos/:owner/:slug/checkpoints', renderMode: RenderMode.Client },
  { path: 'dashboard/repos/:owner/:slug', renderMode: RenderMode.Client },
  { path: 'dashboard/repos/:slug', renderMode: RenderMode.Client },
  { path: 'dashboard/apps/:slug', renderMode: RenderMode.Client },
  { path: 'dashboard/listings/:slug', renderMode: RenderMode.Client },
  { path: 'dashboard/deployments/:id', renderMode: RenderMode.Client },
  { path: 'dashboard/cloudflare', renderMode: RenderMode.Client },
  { path: 'dashboard', renderMode: RenderMode.Client },
  { path: 'admin/repos/:owner/:slug/checkpoints', renderMode: RenderMode.Client },
  { path: 'admin', renderMode: RenderMode.Client },
  // Owner and repo pages (#102): rendered per request for SEO.
  { path: ':owner/:slug/pulls/new', renderMode: RenderMode.Client },
  { path: ':owner/:slug/pulls/:number', renderMode: RenderMode.Client },
  { path: ':owner/:slug/pulls', renderMode: RenderMode.Client },
  { path: ':owner/:slug/code', renderMode: RenderMode.Client },
  { path: ':owner/:slug/history', renderMode: RenderMode.Server },
  { path: ':owner/:slug', renderMode: RenderMode.Server },
  { path: ':owner', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
