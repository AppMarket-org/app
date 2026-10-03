import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Repo, RepoEvent, RepoUpdate, Release, ReleasePlatform, GitToken, Screenshot, TokenRecord, TransitionRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Owner-side API for the developer dashboard (PRD R16). */
@Injectable({ providedIn: 'root' })
export class Developer {
  private readonly http = inject(HttpClient);

  mine(): Observable<Repo[]> {
    return this.http.get<{ items: Repo[] }>('/api/repos/mine').pipe(map((r) => r.items));
  }

  repo(slug: string): Observable<Repo> {
    return this.http.get<Repo>(`/api/repos/${slug}`);
  }

  /** The repo's Git storage (Artifacts): name and clone remote. */
  git(slug: string): Observable<{ name: string; remote: string }> {
    return this.http.get<{ name: string; remote: string }>(`/api/repos/${slug}/git`);
  }

  writeToken(slug: string): Observable<GitToken> {
    return this.http.post<GitToken>(`/api/repos/${slug}/tokens`, { scope: 'write' });
  }

  transition(slug: string, request: TransitionRequest): Observable<Repo> {
    return this.http.post<Repo>(`/api/repos/${slug}/transitions`, request);
  }

  update(slug: string, update: RepoUpdate): Observable<Repo> {
    return this.http.patch<Repo>(`/api/repos/${slug}`, update);
  }

  screenshots(slug: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/repos/${slug}/screenshots`).pipe(map((r) => r.items));
  }

  /** Sends the file's bytes as the body; the API checks the real image type. */
  uploadScreenshot(slug: string, file: File): Observable<Screenshot> {
    return this.http.post<Screenshot>(`/api/repos/${slug}/screenshots`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  }

  deleteScreenshot(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/repos/${slug}/screenshots/${id}`);
  }

  tokens(slug: string): Observable<TokenRecord[]> {
    return this.http.get<{ items: TokenRecord[] }>(`/api/repos/${slug}/tokens`).pipe(map((r) => r.items));
  }

  revokeToken(slug: string, id: string): Observable<{ revoked: boolean }> {
    return this.http.delete<{ revoked: boolean }>(`/api/repos/${slug}/tokens/${id}`);
  }

  revokeAllTokens(slug: string): Observable<{ revoked: number }> {
    return this.http.post<{ revoked: number }>(`/api/repos/${slug}/tokens/revoke-all`, {});
  }

  releases(slug: string): Observable<Release[]> {
    return this.http.get<{ items: Release[] }>(`/api/repos/${slug}/releases`).pipe(map((r) => r.items));
  }

  /** Uploads the file as the body with progress events; the API and R2 verify the SHA-256. */
  uploadRelease(slug: string, file: File, meta: { tag: string; platform: ReleasePlatform; sha256: string }): Observable<HttpEvent<Release>> {
    return this.http.post<Release>(`/api/repos/${slug}/releases`, file, {
      params: { ...meta, filename: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
      reportProgress: true,
      observe: 'events',
    });
  }

  deleteRelease(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/repos/${slug}/releases/${id}`);
  }

  events(slug: string): Observable<RepoEvent[]> {
    return this.http.get<{ items: RepoEvent[] }>(`/api/repos/${slug}/events`).pipe(map((r) => r.items));
  }
}
