import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Listing, ListingEvent, RepoToken, TransitionRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Owner-side API for the developer dashboard (PRD R16). */
@Injectable({ providedIn: 'root' })
export class Developer {
  private readonly http = inject(HttpClient);

  mine(): Observable<Listing[]> {
    return this.http.get<{ items: Listing[] }>('/api/listings/mine').pipe(map((r) => r.items));
  }

  listing(slug: string): Observable<Listing> {
    return this.http.get<Listing>(`/api/listings/${slug}`);
  }

  repo(slug: string): Observable<{ name: string; remote: string }> {
    return this.http.get<{ name: string; remote: string }>(`/api/listings/${slug}/repo`);
  }

  writeToken(slug: string): Observable<RepoToken> {
    return this.http.post<RepoToken>(`/api/listings/${slug}/tokens`, { scope: 'write' });
  }

  transition(slug: string, request: TransitionRequest): Observable<Listing> {
    return this.http.post<Listing>(`/api/listings/${slug}/transitions`, request);
  }

  events(slug: string): Observable<ListingEvent[]> {
    return this.http.get<{ items: ListingEvent[] }>(`/api/listings/${slug}/events`).pipe(map((r) => r.items));
  }
}
