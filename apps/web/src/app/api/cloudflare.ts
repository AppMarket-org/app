import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CloudflareAccount, CloudflareConnection } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** PRD D5: the buyer's Cloudflare account connection. */
@Injectable({ providedIn: 'root' })
export class CloudflareApi {
  private readonly http = inject(HttpClient);

  connection(): Observable<CloudflareConnection> {
    return this.http.get<CloudflareConnection>('/api/cloudflare/connection');
  }

  accounts(): Observable<CloudflareAccount[]> {
    return this.http.get<{ items: CloudflareAccount[] }>('/api/cloudflare/accounts').pipe(map((r) => r.items));
  }

  disconnect(): Observable<unknown> {
    return this.http.post('/api/cloudflare/disconnect', {});
  }

  /** Full-page navigation: the OAuth flow leaves the app. */
  connectUrl(returnTo: string): string {
    return `/api/cloudflare/connect?return=${encodeURIComponent(returnTo)}`;
  }
}
