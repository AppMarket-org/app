import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Repo, RepoEvent, RepoUpdate, RepoVisibility, Release, ReleasePlatform, GitToken, Screenshot, TokenRecord, TransitionRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Owner-side API for the developer dashboard (PRD R16). */
@Injectable({ providedIn: 'root' })
export class Developer {
  private readonly http = inject(HttpClient);

  mine(): Observable<Repo[]> {
    return this.http.get<{ items: Repo[] }>('/api/repos/mine').pipe(map((r) => r.items));
  }

  repo(path: string): Observable<Repo> {
    return this.http.get<Repo>(`/api/repos/${path}`);
  }

  /** The repo's Git storage (Artifacts): name and clone remote. */
  git(path: string): Observable<{ name: string; remote: string }> {
    return this.http.get<{ name: string; remote: string }>(`/api/repos/${path}/git`);
  }

  writeToken(path: string): Observable<GitToken> {
    return this.http.post<GitToken>(`/api/repos/${path}/tokens`, { scope: 'write' });
  }

  transition(path: string, request: TransitionRequest): Observable<Repo> {
    return this.http.post<Repo>(`/api/repos/${path}/transitions`, request);
  }

  /** #366: private or public. */
  setVisibility(path: string, visibility: RepoVisibility): Observable<Repo> {
    return this.http.put<Repo>(`/api/repos/${path}/visibility`, { visibility });
  }

  update(path: string, update: RepoUpdate): Observable<Repo> {
    return this.http.patch<Repo>(`/api/repos/${path}`, update);
  }

  screenshots(path: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/repos/${path}/screenshots`).pipe(map((r) => r.items));
  }

  /** Sends the file's bytes as the body; the API checks the real image type. */
  uploadScreenshot(path: string, file: File): Observable<Screenshot> {
    return this.http.post<Screenshot>(`/api/repos/${path}/screenshots`, file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  }

  deleteScreenshot(path: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/repos/${path}/screenshots/${id}`);
  }

  tokens(path: string): Observable<TokenRecord[]> {
    return this.http.get<{ items: TokenRecord[] }>(`/api/repos/${path}/tokens`).pipe(map((r) => r.items));
  }

  revokeToken(path: string, id: string): Observable<{ revoked: boolean }> {
    return this.http.delete<{ revoked: boolean }>(`/api/repos/${path}/tokens/${id}`);
  }

  revokeAllTokens(path: string): Observable<{ revoked: number }> {
    return this.http.post<{ revoked: number }>(`/api/repos/${path}/tokens/revoke-all`, {});
  }

  releases(path: string): Observable<Release[]> {
    return this.http.get<{ items: Release[] }>(`/api/repos/${path}/releases`).pipe(map((r) => r.items));
  }

  /** Uploads the file as the body with progress events; the API and R2 verify the SHA-256. */
  uploadRelease(path: string, file: File, meta: { tag: string; platform: ReleasePlatform; sha256: string }): Observable<HttpEvent<Release>> {
    return this.http.post<Release>(`/api/repos/${path}/releases`, file, {
      params: { ...meta, filename: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
      reportProgress: true,
      observe: 'events',
    });
  }

  deleteRelease(path: string, id: string): Observable<void> {
    return this.http.delete<void>(`/api/repos/${path}/releases/${id}`);
  }

  events(path: string): Observable<RepoEvent[]> {
    return this.http.get<{ items: RepoEvent[] }>(`/api/repos/${path}/events`).pipe(map((r) => r.items));
  }
}
