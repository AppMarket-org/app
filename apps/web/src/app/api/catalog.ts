import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CategorySlug, DownloadLink, RepoPage, RepoVersion, Release, GitToken, Runtime, Screenshot } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

export interface CatalogQuery {
  q?: string;
  category?: CategorySlug;
  runtime?: Runtime;
  page?: number;
  pageSize?: number;
}

/** Typed access to the catalog API (works in SSR via the server interceptor). */
@Injectable({ providedIn: 'root' })
export class Catalog {
  private readonly http = inject(HttpClient);

  search(query: CatalogQuery): Observable<RepoPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<RepoPage>('/api/repos', { params });
  }

  screenshots(slug: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/repos/${slug}/screenshots`).pipe(map((r) => r.items));
  }

  versions(slug: string): Observable<RepoVersion[]> {
    return this.http.get<{ items: RepoVersion[] }>(`/api/repos/${slug}/versions`).pipe(map((r) => r.items));
  }

  readme(slug: string): Observable<string> {
    return this.http.get<{ markdown: string }>(`/api/repos/${slug}/readme`).pipe(map((r) => r.markdown));
  }

  releases(slug: string): Observable<Release[]> {
    return this.http.get<{ items: Release[] }>(`/api/repos/${slug}/releases`).pipe(map((r) => r.items));
  }

  downloadLink(releaseId: string): Observable<DownloadLink> {
    return this.http.post<DownloadLink>(`/api/releases/${releaseId}/link`, {});
  }

  repoMap(slug: string): Observable<string> {
    return this.http.get(`/api/repos/${slug}/repo-map`, { responseType: 'text' });
  }

  readToken(slug: string): Observable<GitToken> {
    return this.http.post<GitToken>(`/api/repos/${slug}/tokens`, { scope: 'read', ttl: 3600 });
  }
}
