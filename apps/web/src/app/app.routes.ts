import { Routes } from '@angular/router';
import { authGuard } from './auth/auth-guard';
import { categoryResolver, latestResolver, searchResolver } from './pages/catalog-resolvers';
import { historyResolver } from './pages/history/history-resolver';
import { ownerResolver } from './pages/owner/owner-resolver';
import { repoResolver } from './pages/repo/repo-resolver';

// Public pages are server-rendered for SEO (see app.routes.server.ts); /dashboard, /settings, /admin
// and /login are client-only. Owner and repo pages (#102) come last: their first segment is a
// handle, so every site path above is a reserved handle (RESERVED_HANDLES).
export const routes: Routes = [
  { path: '', resolve: { latest: latestResolver }, loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'category/:slug', resolve: { results: categoryResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/category/category').then((m) => m.Category) },
  { path: 'search', resolve: { results: searchResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
  { path: 'legal/:page', loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'device', canActivate: [authGuard()], loadComponent: () => import('./pages/device/device').then((m) => m.DevicePage) },
  { path: 'settings/orgs/new', canActivate: [authGuard()], loadComponent: () => import('./pages/settings/new-org/new-org').then((m) => m.NewOrg) },
  { path: 'settings/orgs/:handle', canActivate: [authGuard()], loadComponent: () => import('./pages/settings/org-settings/org-settings').then((m) => m.OrgSettings) },
  { path: 'settings', canActivate: [authGuard()], loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings) },
  { path: 'dashboard/new', canActivate: [authGuard()], loadComponent: () => import('./pages/new-repo/new-repo').then((m) => m.NewRepo) },
  { path: 'dashboard/repos/:owner/:slug/checkpoints', canActivate: [authGuard()], loadComponent: () => import('./pages/checkpoints/checkpoints').then((m) => m.CheckpointsPage) },
  { path: 'dashboard/repos/:owner/:slug', canActivate: [authGuard()], loadComponent: () => import('./pages/manage-repo/manage-repo').then((m) => m.ManageRepo) },
  // Older links without an owner (before #102).
  { path: 'dashboard/repos/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/apps/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/listings/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/deployments/:id', canActivate: [authGuard()], loadComponent: () => import('./pages/deployment/deployment').then((m) => m.DeploymentPage) },
  { path: 'dashboard/cloudflare', canActivate: [authGuard()], loadComponent: () => import('./pages/cloudflare-account/cloudflare-account').then((m) => m.CloudflareAccountPage) },
  { path: 'dashboard', canActivate: [authGuard()], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'admin', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin) },
  { path: ':owner/:slug/history', resolve: { history: historyResolver }, loadComponent: () => import('./pages/history/history').then((m) => m.HistoryPage) },
  { path: ':owner/:slug', resolve: { details: repoResolver }, loadComponent: () => import('./pages/repo/repo').then((m) => m.RepoPage) },
  { path: ':owner', resolve: { page: ownerResolver }, loadComponent: () => import('./pages/owner/owner').then((m) => m.OwnerPage) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
