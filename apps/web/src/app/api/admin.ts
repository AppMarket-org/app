import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Repo, RepoReport, RepoState, TransitionRequest } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** Admin moderation API (PRD R18). */
@Injectable({ providedIn: 'root' })
export class Admin {
  private readonly http = inject(HttpClient);

  repos(state: RepoState): Observable<Repo[]> {
    return this.http.get<{ items: Repo[] }>('/api/admin/repos', { params: { state } }).pipe(map((r) => r.items));
  }

  readme(path: string): Observable<string> {
    return this.http.get<{ markdown: string }>(`/api/repos/${path}/readme`, { params: { version: 'submitted' } }).pipe(map((r) => r.markdown));
  }

  transition(path: string, request: TransitionRequest): Observable<Repo> {
    return this.http.post<Repo>(`/api/repos/${path}/transitions`, request);
  }

  reports(status: 'open' | 'resolved'): Observable<RepoReport[]> {
    return this.http.get<{ items: RepoReport[] }>('/api/admin/reports', { params: { status } }).pipe(map((r) => r.items));
  }

  resolveReport(id: string, resolution: 'dismissed' | 'taken_down', note?: string): Observable<{ resolved: boolean }> {
    return this.http.post<{ resolved: boolean }>(`/api/admin/reports/${id}/resolve`, { resolution, note });
  }
}
