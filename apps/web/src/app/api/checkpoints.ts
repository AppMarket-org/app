import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Checkpoint, CheckpointAccess, CheckpointPage, CheckpointVisibility, CommitEntry } from '@appmarket/shared';
import type { Observable } from 'rxjs';

/** Checkpoints PRD: the prompts, harness and effort behind each commit of a repo. */
@Injectable({ providedIn: 'root' })
export class CheckpointsApi {
  private readonly http = inject(HttpClient);

  /** `view: 'public'` asks for what anyone sees, even when the owner is signed in (build history). */
  list(path: string, query: { before?: string; limit?: number; view?: 'public' } = {}): Observable<CheckpointPage> {
    const params: Record<string, string> = {};
    if (query.view) params['view'] = query.view;
    if (query.before) params['before'] = query.before;
    if (query.limit) params['limit'] = String(query.limit);
    return this.http.get<CheckpointPage>(`/api/repos/${path}/checkpoints`, { params });
  }

  /** A branch's commit history (default: the default branch), with prompts where visible. */
  commits(path: string, ref: string | null, offset = 0): Observable<{ ref: string; items: CommitEntry[]; next: number | null }> {
    const params: Record<string, string> = { offset: String(offset) };
    if (ref) params['ref'] = ref;
    return this.http.get<{ ref: string; items: CommitEntry[]; next: number | null }>(`/api/repos/${path}/commits`, { params });
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

  /** #130: private checkpoints in a session that a visibility change would expose. */
  previewSession(path: string, session: string): Observable<{ becomingVisible: number }> {
    return this.http.get<{ becomingVisible: number }>(`/api/repos/${path}/checkpoints/visibility-preview`, { params: { session } });
  }

  /** #135: moderator access to this repo's private checkpoints. */
  accessLog(path: string): Observable<{ items: CheckpointAccess[] }> {
    return this.http.get<{ items: CheckpointAccess[] }>(`/api/repos/${path}/checkpoints/access-log`);
  }

  setDefault(path: string, visibility: CheckpointVisibility): Observable<{ visibility: CheckpointVisibility }> {
    return this.http.put<{ visibility: CheckpointVisibility }>(`/api/repos/${path}/checkpoint-settings`, { visibility });
  }

  delete(path: string, sha: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`/api/repos/${path}/checkpoints/${sha}`);
  }
}
