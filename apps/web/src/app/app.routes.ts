import { Routes } from '@angular/router';
import { authGuard } from './auth/auth-guard';
import { listingResolver } from './pages/listing/listing-resolver';

// Public pages are server-rendered for SEO (see app.routes.server.ts); /dashboard, /admin and /login are client-only.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home) },
  { path: 'apps/:slug', resolve: { listing: listingResolver }, loadComponent: () => import('./pages/listing/listing').then((m) => m.Listing) },
  { path: 'category/:slug', loadComponent: () => import('./pages/category/category').then((m) => m.Category) },
  { path: 'search', loadComponent: () => import('./pages/search/search').then((m) => m.Search) },
  { path: 'legal/:page', loadComponent: () => import('./pages/legal/legal').then((m) => m.Legal) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'dashboard', canActivate: [authGuard()], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'admin', canActivate: [authGuard('admin')], loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound) },
];
