import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Listing, ListingReport, ListingState, TransitionRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Admin moderation API (PRD R18). */
@Injectable({ providedIn: 'root' })
export class Admin {
  private readonly http = inject(HttpClient);

  listings(state: ListingState): Observable<Listing[]> {
    return this.http.get<{ items: Listing[] }>('/api/admin/listings', { params: { state } }).pipe(map((r) => r.items));
  }

  readme(slug: string): Observable<string> {
    return this.http.get<{ markdown: string }>(`/api/listings/${slug}/readme`, { params: { version: 'submitted' } }).pipe(map((r) => r.markdown));
  }

  transition(slug: string, request: TransitionRequest): Observable<Listing> {
    return this.http.post<Listing>(`/api/listings/${slug}/transitions`, request);
  }

  reports(status: 'open' | 'resolved'): Observable<ListingReport[]> {
    return this.http.get<{ items: ListingReport[] }>('/api/admin/reports', { params: { status } }).pipe(map((r) => r.items));
  }

  resolveReport(id: string, resolution: 'dismissed' | 'taken_down', note?: string): Observable<{ resolved: boolean }> {
    return this.http.post<{ resolved: boolean }>(`/api/admin/reports/${id}/resolve`, { resolution, note });
  }
}
