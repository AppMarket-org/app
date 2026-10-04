import { HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { catchError, of, throwError } from 'rxjs';
import { OwnersApi, type OwnerPage } from '../../api/owners';

export type OwnerPageData = OwnerPage | null;

/** #102: a user or organization page; an unknown handle becomes an HTTP 404. */
export const ownerResolver: ResolveFn<OwnerPageData> = (route) => {
  const response = inject(RESPONSE_INIT, { optional: true });
  return inject(OwnersApi)
    .page(route.paramMap.get('owner') ?? '')
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
