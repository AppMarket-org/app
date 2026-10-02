import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Deployment, DeploymentRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** PRD D6: one-click deploys into the buyer's Cloudflare account. */
@Injectable({ providedIn: 'root' })
export class DeploymentsApi {
  private readonly http = inject(HttpClient);

  start(slug: string, request: DeploymentRequest): Observable<Deployment> {
    return this.http.post<Deployment>(`/api/listings/${slug}/deployments`, request);
  }

  get(id: string): Observable<Deployment> {
    return this.http.get<Deployment>(`/api/deployments/${id}`);
  }

  mine(): Observable<Deployment[]> {
    return this.http.get<{ items: Deployment[] }>('/api/deployments').pipe(map((r) => r.items));
  }
}
