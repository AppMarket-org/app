import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Listing, ListingEvent, ListingUpdate, Release, ReleasePlatform, RepoToken, Screenshot, TokenRecord, TransitionRequest } from '@appmarket/shared';
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

  update(slug: string, update: ListingUpdate): Observable<Listing> {
    return this.http.patch<Listing>(`/api/listings/${slug}`, update);
  }

  screenshots(slug: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/listings/${slug}/screenshots`).pipe(map((r) => r.items));
  }

  /** Sends the file's bytes as the body; the API checks the real image type. */
  uploadScreenshot(slug: string, file: File): Observable<Screenshot> {
    return this.http.post<Screenshot>(`/api/listings/${slug}/screenshots`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  }

  deleteScreenshot(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/listings/${slug}/screenshots/${id}`);
  }

  tokens(slug: string): Observable<TokenRecord[]> {
    return this.http.get<{ items: TokenRecord[] }>(`/api/listings/${slug}/tokens`).pipe(map((r) => r.items));
  }

  revokeToken(slug: string, id: string): Observable<{ revoked: boolean }> {
    return this.http.delete<{ revoked: boolean }>(`/api/listings/${slug}/tokens/${id}`);
  }

  revokeAllTokens(slug: string): Observable<{ revoked: number }> {
    return this.http.post<{ revoked: number }>(`/api/listings/${slug}/tokens/revoke-all`, {});
  }

  releases(slug: string): Observable<Release[]> {
    return this.http.get<{ items: Release[] }>(`/api/listings/${slug}/releases`).pipe(map((r) => r.items));
  }

  /** Uploads the file as the body with progress events; the API and R2 verify the SHA-256. */
  uploadRelease(slug: string, file: File, meta: { tag: string; platform: ReleasePlatform; sha256: string }): Observable<HttpEvent<Release>> {
    return this.http.post<Release>(`/api/listings/${slug}/releases`, file, {
      params: { ...meta, filename: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
      reportProgress: true,
      observe: 'events',
    });
  }

  deleteRelease(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/listings/${slug}/releases/${id}`);
  }

  events(slug: string): Observable<ListingEvent[]> {
    return this.http.get<{ items: ListingEvent[] }>(`/api/listings/${slug}/events`).pipe(map((r) => r.items));
  }
}
