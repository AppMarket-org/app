import { HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { catchError, map, of, switchMap, throwError } from 'rxjs';
import { OwnersApi, type OwnerPage } from '../../api/owners';

export type OwnerPageData = OwnerPage | null;

/** #102: a user or organization page; an unknown handle becomes an HTTP 404. */
export const ownerResolver: ResolveFn<OwnerPageData> = (route) => {
  const response = inject(RESPONSE_INIT, { optional: true });
  const api = inject(OwnersApi);
  const handle = route.paramMap.get('owner') ?? '';
  return api
    .page(handle)
    .pipe(
      // #144: users' contribution calendar renders with the page; a failure only hides the graph.
      switchMap((page) =>
        page.owner.kind === 'user'
          ? api.contributions(handle).pipe(
              map((contributions) => ({ ...page, contributions })),
              catchError(() => of(page)),
            )
          : of(page),
      ),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          if (response) response.status = 404;
          return of(null);
        }
        return throwError(() => error);
      }),
    );
};
