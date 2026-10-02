import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { Listing } from '@appmarket/shared';
import { catchError, of, throwError } from 'rxjs';

/** Loads the listing before render (SSR waits for it); a missing listing becomes an HTTP 404. */
export const listingResolver: ResolveFn<Listing | null> = (route) => {
  const response = inject(RESPONSE_INIT, { optional: true });
  return inject(HttpClient)
    .get<Listing>(`/api/listings/${encodeURIComponent(route.paramMap.get('slug') ?? '')}`)
    .pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          if (response) response.status = 404;
          return of(null);
        }
        return throwError(() => error);
      }),
    );
};
