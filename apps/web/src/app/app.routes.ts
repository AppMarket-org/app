import { Routes } from '@angular/router';
import { authGuard } from './auth/auth-guard';
import { categoryResolver, latestResolver, searchResolver } from './pages/catalog-resolvers';
import { listingResolver } from './pages/listing/listing-resolver';

// Public pages are server-rendered for SEO (see app.routes.server.ts); /dashboard, /admin and /login are client-only.
export const routes: Routes = [
  { path: '', resolve: { latest: latestResolver }, loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'apps/:slug', resolve: { details: listingResolver }, loadComponent: () => import('./pages/listing/listing').then((m) => m.Listing) },
  { path: 'category/:slug', resolve: { results: categoryResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/category/category').then((m) => m.Category) },
  { path: 'search', resolve: { results: searchResolver }, runGuardsAndResolvers: 'paramsOrQueryParamsChange', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
  { path: 'legal/:page', loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'dashboard/new', canActivate: [authGuard()], loadComponent: () => import('./pages/create-listing/create-listing').then((m) => m.CreateListing) },
  { path: 'dashboard/listings/:slug', canActivate: [authGuard()], loadComponent: () => import('./pages/manage-listing/manage-listing').then((m) => m.ManageListing) },
  { path: 'dashboard', canActivate: [authGuard()], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'admin', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
