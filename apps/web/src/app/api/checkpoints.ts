import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Checkpoint, CheckpointPage, CheckpointVisibility } from '@appmarket/shared';
import type { Observable } from 'rxjs';

/** Checkpoints PRD: the prompts, harness and effort behind each commit of a repo. */
@Injectable({ providedIn: 'root' })
export class CheckpointsApi {
  private readonly http = inject(HttpClient);

  list(path: string, query: { before?: string; limit?: number } = {}): Observable<CheckpointPage> {
    const params: Record<string, string> = {};
    if (query.before) params['before'] = query.before;
    if (query.limit) params['limit'] = String(query.limit);
    return this.http.get<CheckpointPage>(`/api/repos/${path}/checkpoints`, { params });
  }

  setVisibility(path: string, sha: string, visibility: CheckpointVisibility): Observable<Checkpoint> {
    return this.http.patch<Checkpoint>(`/api/repos/${path}/checkpoints/${sha}`, { visibility });
  }

  addPrompt(path: string, sha: string, prompt: string): Observable<Checkpoint> {
    return this.http.patch<Checkpoint>(`/api/repos/${path}/checkpoints/${sha}`, { add_prompt: prompt });
  }

  setSessionVisibility(path: string, session: string, visibility: CheckpointVisibility): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(`/api/repos/${path}/checkpoints/visibility`, { session, visibility });
  }

  setDefault(path: string, visibility: CheckpointVisibility): Observable<{ visibility: CheckpointVisibility }> {
    return this.http.put<{ visibility: CheckpointVisibility }>(`/api/repos/${path}/checkpoint-settings`, { visibility });
  }

  delete(path: string, sha: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`/api/repos/${path}/checkpoints/${sha}`);
  }
}
