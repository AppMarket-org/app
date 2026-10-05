import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Deployment, DeploymentRequest, RuntimeLogEvent, WorkerVersion } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** PRD D6: one-click deploys into the buyer's Cloudflare account. */
@Injectable({ providedIn: 'root' })
export class DeploymentsApi {
  private readonly http = inject(HttpClient);

  start(path: string, request: DeploymentRequest): Observable<Deployment> {
    return this.http.post<Deployment>(`/api/repos/${path}/deployments`, request);
  }

  get(id: string): Observable<Deployment> {
    return this.http.get<Deployment>(`/api/deployments/${id}`);
  }

  mine(): Observable<Deployment[]> {
    return this.http.get<{ items: Deployment[] }>('/api/deployments').pipe(map((r) => r.items));
  }

  /** #38 */
  versions(id: string): Observable<WorkerVersion[]> {
    return this.http.get<{ items: WorkerVersion[] }>(`/api/deployments/${id}/versions`).pipe(map((r) => r.items));
  }

  /** A failed automatic deploy (auto deploy or a preview), deployed again; the new deployment's id. */
  retry(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/deployments/${id}/retry`, {});
  }

  rollback(id: string, versionId: string): Observable<unknown> {
    return this.http.post(`/api/deployments/${id}/rollback`, { versionId });
  }

  /** #40 */
  logs(id: string): Observable<string | null> {
    return this.http.get<{ logs: string | null }>(`/api/deployments/${id}/logs`).pipe(map((r) => r.logs));
  }

  runtimeLogs(id: string, minutes: number): Observable<RuntimeLogEvent[]> {
    return this.http.get<{ items: RuntimeLogEvent[] }>(`/api/deployments/${id}/runtime-logs`, { params: { minutes } }).pipe(map((r) => r.items));
  }
}
