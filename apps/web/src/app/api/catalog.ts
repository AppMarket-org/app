import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CategorySlug, DownloadLink, RepoPage, RepoSort, RepoVersion, Release, GitToken, Runtime, Screenshot } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

export interface CatalogQuery {
  q?: string;
  category?: CategorySlug;
  runtime?: Runtime;
  sort?: RepoSort;
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

  screenshots(path: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/repos/${path}/screenshots`).pipe(map((r) => r.items));
  }

  versions(path: string): Observable<RepoVersion[]> {
    return this.http.get<{ items: RepoVersion[] }>(`/api/repos/${path}/versions`).pipe(map((r) => r.items));
  }

  readme(path: string): Observable<string> {
    return this.http.get<{ markdown: string }>(`/api/repos/${path}/readme`).pipe(map((r) => r.markdown));
  }

  releases(path: string): Observable<Release[]> {
    return this.http.get<{ items: Release[] }>(`/api/repos/${path}/releases`).pipe(map((r) => r.items));
  }

  downloadLink(releaseId: string): Observable<DownloadLink> {
    return this.http.post<DownloadLink>(`/api/releases/${releaseId}/link`, {});
  }

  repoMap(path: string): Observable<string> {
    return this.http.get(`/api/repos/${path}/repo-map`, { responseType: 'text' });
  }

  readToken(path: string): Observable<GitToken> {
    return this.http.post<GitToken>(`/api/repos/${path}/tokens`, { scope: 'read', ttl: 3600 });
  }
}
