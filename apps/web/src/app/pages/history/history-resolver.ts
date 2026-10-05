import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT, inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { CheckpointPage, Repo } from '@appmarket/shared';
import { catchError, forkJoin, map, of, throwError } from 'rxjs';
import { CheckpointsApi } from '../../api/checkpoints';

export interface HistoryData {
  repo: Repo;
  page: CheckpointPage;
  /** #72: the G5 backstop for the published version (commits without a checkpoint). */
  unattributed: { count: number; of: number } | null;
}

/** #117: the repo and its first page of published checkpoints, before render (SSR waits). */
export const historyResolver: ResolveFn<HistoryData | null> = (route) => {
  const response = inject(RESPONSE_INIT, { optional: true });
  const path = `${encodeURIComponent(route.paramMap.get('owner') ?? '')}/${encodeURIComponent(route.paramMap.get('slug') ?? '')}`;
  return forkJoin({
    repo: inject(HttpClient).get<Repo>(`/api/repos/${path}`),
    // Always the public view: the page shows what everyone sees, also to the signed-in owner.
    page: inject(CheckpointsApi).list(path, { view: 'public', limit: 50 }),
    unattributed: inject(HttpClient)
      .get<{ results: { id: string; status: string; details: string[] }[] }>(`/api/repos/${path}/conformance`)
      .pipe(
        map((r) => {
          const m = /(\d+) of the last (\d+)/.exec(r.results.find((x) => x.id === 'attributed-commits' && x.status === 'fail')?.details[0] ?? '');
          return m ? { count: Number(m[1]), of: Number(m[2]) } : null;
        }),
        catchError(() => of(null)),
      ),
  }).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
        if (response) response.status = error.status;
        return of(null);
      }
      return throwError(() => error);
    }),
  );
};
