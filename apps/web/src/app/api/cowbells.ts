import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CowbellStatus, Repo } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Cowbells: appmarket's stars for repos. */
@Injectable({ providedIn: 'root' })
export class CowbellsApi {
  private readonly http = inject(HttpClient);

  status(slug: string): Observable<CowbellStatus> {
    return this.http.get<CowbellStatus>(`/api/repos/${slug}/cowbell`);
  }

  set(slug: string, on: boolean): Observable<CowbellStatus> {
    return on ? this.http.put<CowbellStatus>(`/api/repos/${slug}/cowbell`, {}) : this.http.delete<CowbellStatus>(`/api/repos/${slug}/cowbell`);
  }

  mine(): Observable<Repo[]> {
    return this.http.get<{ items: Repo[] }>('/api/cowbells').pipe(map((r) => r.items));
  }
}
