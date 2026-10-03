import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { CATEGORIES, RUNTIMES, type CategorySlug, type RepoPage, type Runtime } from '@appmarket/shared';
import { type Observable, catchError, of } from 'rxjs';
import { Catalog } from '../api/catalog';

const PAGE_SIZE = 24;
const EMPTY: RepoPage = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0 };

/** If the API is unreachable, render an empty page with 503 so crawlers retry instead of indexing it. */
function orUnavailable(source: Observable<RepoPage>, response: ResponseInit | null): Observable<RepoPage> {
  return source.pipe(
    catchError(() => {
      if (response) response.status = 503;
      return of(EMPTY);
    }),
  );
}

const isCategory = (v: string | null): v is CategorySlug => CATEGORIES.some((c) => c.slug === v);
const isRuntime = (v: string | null): v is Runtime => v !== null && v in RUNTIMES;
const pageOf = (v: string | null) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1);

/** Home: the newest published repos. */
export const latestResolver: ResolveFn<RepoPage> = () => orUnavailable(inject(Catalog).search({ pageSize: 12 }), inject(RESPONSE_INIT, { optional: true }));

/** Search: q, category, runtime and page from the query string; unknown filters are ignored. */
export const searchResolver: ResolveFn<RepoPage> = (route) => {
  const q = route.queryParamMap;
  const response = inject(RESPONSE_INIT, { optional: true });
  return orUnavailable(inject(Catalog).search({
    q: q.get('q')?.slice(0, 100) || undefined,
    category: isCategory(q.get('category')) ? (q.get('category') as CategorySlug) : undefined,
    runtime: isRuntime(q.get('runtime')) ? (q.get('runtime') as Runtime) : undefined,
    page: pageOf(q.get('page')),
    pageSize: PAGE_SIZE,
  }), response);
};

/** Category page; an unknown category is a 404. */
export const categoryResolver: ResolveFn<RepoPage> = (route) => {
  const slug = route.paramMap.get('slug');
  if (!isCategory(slug)) {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
    return of(EMPTY);
  }
  return orUnavailable(inject(Catalog).search({ category: slug, page: pageOf(route.queryParamMap.get('page')), pageSize: PAGE_SIZE }), inject(RESPONSE_INIT, { optional: true }));
};
