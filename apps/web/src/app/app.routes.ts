import { Routes } from '@angular/router';
import { authGuard } from './auth/auth-guard';
import { repoGuard } from './auth/repo-guard';
import { homeGuard } from './auth/home-guard';
import { categoryResolver, latestResolver, searchResolver } from './pages/catalog-resolvers';
import { historyResolver } from './pages/history/history-resolver';
import { ownerResolver } from './pages/owner/owner-resolver';
import { repoResolver } from './pages/repo/repo-resolver';
import { settingsSectionGuard } from './pages/settings/settings-sections';

// Public pages are server-rendered for SEO (see app.routes.server.ts); /dashboard, /settings, /admin
// and /login are client-only. Owner and repo pages (#102) come last: their first segment is a
// handle, so every site path above is a reserved handle (RESERVED_HANDLES).
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [homeGuard], resolve: { latest: latestResolver }, loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'category/:slug', resolve: { results: categoryResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/category/category').then((m) => m.Category) },
  { path: 'search', resolve: { results: searchResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
  { path: 'email/unsubscribe', loadComponent: () => import('./pages/unsubscribe/unsubscribe').then((m) => m.UnsubscribePage) },
  { path: 'legal/:page', loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'device', canActivate: [authGuard()], loadComponent: () => import('./pages/device/device').then((m) => m.DevicePage) },
  { path: 'settings/orgs/new', canActivate: [authGuard()], loadComponent: () => import('./pages/settings/new-org/new-org').then((m) => m.NewOrg) },
  { path: 'settings/orgs/:handle', canActivate: [authGuard()], loadComponent: () => import('./pages/settings/org-settings/org-settings').then((m) => m.OrgSettings) },
  { path: 'settings', pathMatch: 'full', redirectTo: 'settings/profile' },
  { path: 'settings/:section', canActivate: [authGuard(), settingsSectionGuard], loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings) },
  { path: 'dashboard/new', canActivate: [authGuard()], loadComponent: () => import('./pages/new-repo/new-repo').then((m) => m.NewRepo) },
  { path: 'dashboard/repos/:owner/:slug/agents', canActivate: [authGuard()], loadComponent: () => import('./pages/agents/agents').then((m) => m.AgentsPage) },
  { path: 'dashboard/repos/:owner/:slug/memory', canActivate: [authGuard()], loadComponent: () => import('./pages/memory/memory').then((m) => m.MemoryPage) },
  { path: 'dashboard/repos/:owner/:slug/checkpoints', canActivate: [authGuard()], loadComponent: () => import('./pages/checkpoints/checkpoints').then((m) => m.CheckpointsPage) },
  { path: 'dashboard/repos/:owner/:slug', canActivate: [authGuard()], loadComponent: () => import('./pages/manage-repo/manage-repo').then((m) => m.ManageRepo) },
  // Older links without an owner (before #102).
  { path: 'dashboard/repos/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/apps/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/listings/:slug', redirectTo: 'dashboard' },
  { path: 'dashboard/deployments/:id', canActivate: [authGuard()], loadComponent: () => import('./pages/deployment/deployment').then((m) => m.DeploymentPage) },
  { path: 'dashboard/cloudflare', canActivate: [authGuard()], loadComponent: () => import('./pages/cloudflare-account/cloudflare-account').then((m) => m.CloudflareAccountPage) },
  { path: 'dashboard', canActivate: [authGuard()], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard), children: [
    { path: '', pathMatch: 'full', loadComponent: () => import('./pages/dashboard/dashboard-pages').then((m) => m.DashboardRepositories) },
    { path: 'apps', loadComponent: () => import('./pages/dashboard/dashboard-pages').then((m) => m.DashboardRunningApps) },
    { path: 'cowbells', loadComponent: () => import('./pages/dashboard/dashboard-pages').then((m) => m.DashboardCowbells) },
  ] },
  { path: 'admin/repos/:owner/:slug/checkpoints', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin-checkpoints/admin-checkpoints').then((m) => m.AdminCheckpointsPage) },
  { path: 'admin', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin) },
  // Code browser (read-only; Shiki loads in the browser).
  // #259: pull requests.
  // #295: issues.
  { path: ':owner/:slug/issues/new', canActivate: [authGuard(), repoGuard], loadComponent: () => import('./pages/issues/new-issue/new-issue').then((m) => m.NewIssuePage) },
  { path: ':owner/:slug/issues/:number', canActivate: [repoGuard], loadComponent: () => import('./pages/issues/issue/issue').then((m) => m.IssuePage) },
  { path: ':owner/:slug/issues', canActivate: [repoGuard], loadComponent: () => import('./pages/issues/issue-list/issue-list').then((m) => m.IssueListPage) },
  { path: ':owner/:slug/pulls/new', canActivate: [authGuard(), repoGuard], loadComponent: () => import('./pages/pulls/new-pull/new-pull').then((m) => m.NewPullPage) },
  { path: ':owner/:slug/pulls/:number', canActivate: [repoGuard], loadComponent: () => import('./pages/pulls/pull/pull').then((m) => m.PullPage) },
  { path: ':owner/:slug/pulls', canActivate: [repoGuard], loadComponent: () => import('./pages/pulls/pull-list/pull-list').then((m) => m.PullListPage) },
  { path: ':owner/:slug/commits', canActivate: [repoGuard], loadComponent: () => import('./pages/commits/commits').then((m) => m.CommitsPage) },
  { path: ':owner/:slug/code', canActivate: [repoGuard], loadComponent: () => import('./pages/code/code').then((m) => m.CodePage) },
  { path: ':owner/:slug/history', resolve: { history: historyResolver }, loadComponent: () => import('./pages/history/history').then((m) => m.HistoryPage) },
  { path: ':owner/:slug', resolve: { details: repoResolver }, loadComponent: () => import('./pages/repo/repo').then((m) => m.RepoPage) },
  { path: ':owner', resolve: { page: ownerResolver }, loadComponent: () => import('./pages/owner/owner').then((m) => m.OwnerPage) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
