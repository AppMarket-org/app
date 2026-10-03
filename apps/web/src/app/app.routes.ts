import { Routes } from '@angular/router';
import { authGuard } from './auth/auth-guard';
import { categoryResolver, latestResolver, searchResolver } from './pages/catalog-resolvers';
import { repoResolver } from './pages/repo/repo-resolver';

// Public pages are server-rendered for SEO (see app.routes.server.ts); /dashboard, /admin and /login are client-only.
export const routes: Routes = [
  { path: '', resolve: { latest: latestResolver }, loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'apps/:slug', resolve: { details: repoResolver }, loadComponent: () => import('./pages/repo/repo').then((m) => m.RepoPage) },
  { path: 'category/:slug', resolve: { results: categoryResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/category/category').then((m) => m.Category) },
  { path: 'search', resolve: { results: searchResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
  { path: 'legal/:page', loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'dashboard/new', canActivate: [authGuard()], loadComponent: () => import('./pages/new-repo/new-repo').then((m) => m.NewRepo) },
  // Older links: /dashboard/listings/:slug and /dashboard/apps/:slug.
  { path: 'dashboard/listings/:slug', redirectTo: 'dashboard/repos/:slug' },
  { path: 'dashboard/apps/:slug', redirectTo: 'dashboard/repos/:slug' },
  { path: 'dashboard/repos/:slug', canActivate: [authGuard()], loadComponent: () => import('./pages/manage-repo/manage-repo').then((m) => m.ManageRepo) },
  { path: 'dashboard/deployments/:id', canActivate: [authGuard()], loadComponent: () => import('./pages/deployment/deployment').then((m) => m.DeploymentPage) },
  { path: 'dashboard/cloudflare', canActivate: [authGuard()], loadComponent: () => import('./pages/cloudflare-account/cloudflare-account').then((m) => m.CloudflareAccountPage) },
  { path: 'dashboard', canActivate: [authGuard()], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'admin', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
