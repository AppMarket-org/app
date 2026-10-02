import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { CATEGORIES, RUNTIMES, type CategorySlug, type ListingPage, type Runtime } from '@appmarket/shared';
import { of } from 'rxjs';
import { Catalog } from '../api/catalog';

const PAGE_SIZE = 24;
const EMPTY: ListingPage = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0 };

const isCategory = (v: string | null): v is CategorySlug => CATEGORIES.some((c) => c.slug === v);
const isRuntime = (v: string | null): v is Runtime => v !== null && v in RUNTIMES;
const pageOf = (v: string | null) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1);

/** Home: the newest published listings. */
export const latestResolver: ResolveFn<ListingPage> = () => inject(Catalog).search({ pageSize: 12 });

/** Search: q, category, runtime and page from the query string; unknown filters are ignored. */
export const searchResolver: ResolveFn<ListingPage> = (route) => {
  const q = route.queryParamMap;
  return inject(Catalog).search({
    q: q.get('q')?.slice(0, 100) || undefined,
    category: isCategory(q.get('category')) ? (q.get('category') as CategorySlug) : undefined,
    runtime: isRuntime(q.get('runtime')) ? (q.get('runtime') as Runtime) : undefined,
    page: pageOf(q.get('page')),
    pageSize: PAGE_SIZE,
  });
};

/** Category page; an unknown category is a 404. */
export const categoryResolver: ResolveFn<ListingPage> = (route) => {
  const slug = route.paramMap.get('slug');
  if (!isCategory(slug)) {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
    return of(EMPTY);
  }
  return inject(Catalog).search({ category: slug, page: pageOf(route.queryParamMap.get('page')), pageSize: PAGE_SIZE });
};
