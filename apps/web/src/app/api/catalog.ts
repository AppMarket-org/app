import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CategorySlug, ListingPage, ListingVersion, RepoToken, Runtime, Screenshot } from '@appmarket/shared';
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

  search(query: CatalogQuery): Observable<ListingPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<ListingPage>('/api/listings', { params });
  }

  screenshots(slug: string): Observable<Screenshot[]> {
    return this.http.get<{ items: Screenshot[] }>(`/api/listings/${slug}/screenshots`).pipe(map((r) => r.items));
  }

  versions(slug: string): Observable<ListingVersion[]> {
    return this.http.get<{ items: ListingVersion[] }>(`/api/listings/${slug}/versions`).pipe(map((r) => r.items));
  }

  readme(slug: string): Observable<string> {
    return this.http.get<{ markdown: string }>(`/api/listings/${slug}/readme`).pipe(map((r) => r.markdown));
  }

  readToken(slug: string): Observable<RepoToken> {
    return this.http.post<RepoToken>(`/api/listings/${slug}/tokens`, { scope: 'read', ttl: 3600 });
  }
}
