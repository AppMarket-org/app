import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { Listing, ListingVersion, Release, Screenshot } from '@appmarket/shared';
import { catchError, forkJoin, map, of, switchMap, throwError } from 'rxjs';
import { Catalog } from '../../api/catalog';

export interface ListingDetails {
  listing: Listing;
  screenshots: Screenshot[];
  versions: ListingVersion[];
  readme: string | null;
  releases: Release[];
}

/** Loads the listing and its details before render (SSR waits); a missing listing becomes an HTTP 404. */
export const listingResolver: ResolveFn<ListingDetails | null> = (route) => {
  const response = inject(RESPONSE_INIT, { optional: true });
  const catalog = inject(Catalog);
  const slug = encodeURIComponent(route.paramMap.get('slug') ?? '');
  return inject(HttpClient)
    .get<Listing>(`/api/listings/${slug}`)
    .pipe(
      switchMap((listing) =>
        forkJoin({
          screenshots: catalog.screenshots(slug).pipe(catchError(() => of([]))),
          versions: catalog.versions(slug).pipe(catchError(() => of([]))),
          // No README (404) is normal; show nothing.
          readme: catalog.readme(slug).pipe(catchError(() => of(null))),
          releases: catalog.releases(slug).pipe(catchError(() => of([]))),
        }).pipe(map((details) => ({ listing, ...details }))),
      ),
      catchError((error: unknown) => {
        // 404: hidden or missing; 410: removed for good, so search engines drop it.
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
          if (response) response.status = error.status;
          return of(null);
        }
        return throwError(() => error);
      }),
    );
};
