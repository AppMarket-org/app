import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { MemoryChange, MemoryNote, MemorySuggestion } from '@appmarket/shared';
import type { Observable } from 'rxjs';

export interface NoteChange {
  text?: string;
  tags?: string[];
  pinned?: boolean;
  public?: boolean;
}

/** #198: a repo's memory (#194). */
@Injectable({ providedIn: 'root' })
export class MemoryApi {
  private readonly http = inject(HttpClient);

  list(path: string, q = '', tag = ''): Observable<{ notes: MemoryNote[]; total: number; limits: { notesPerRepo: number; text: number } }> {
    const params: Record<string, string> = { limit: '500' };
    if (q) params['q'] = q;
    if (tag) params['tag'] = tag;
    return this.http.get<{ notes: MemoryNote[]; total: number; limits: { notesPerRepo: number; text: number } }>(`/api/repos/${path}/memory`, { params });
  }

  create(path: string, note: NoteChange): Observable<MemoryNote> {
    return this.http.post<MemoryNote>(`/api/repos/${path}/memory`, { ...note, source: 'web' });
  }

  update(path: string, id: string, change: NoteChange): Observable<MemoryNote> {
    return this.http.patch<MemoryNote>(`/api/repos/${path}/memory/${id}`, { ...change, source: 'web' });
  }

  remove(path: string, id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`/api/repos/${path}/memory/${id}`, { params: { source: 'web' } });
  }

  history(path: string, id: string): Observable<{ items: MemoryChange[] }> {
    return this.http.get<{ items: MemoryChange[] }>(`/api/repos/${path}/memory/${id}/history`);
  }

  /** Notes published with an app (its public page). */
  published(path: string): Observable<{ notes: Pick<MemoryNote, 'id' | 'text' | 'tags' | 'pinned' | 'updatedAt'>[] }> {
    return this.http.get<{ notes: Pick<MemoryNote, 'id' | 'text' | 'tags' | 'pinned' | 'updatedAt'>[] }>(`/api/repos/${path}/public-memory`);
  }

  /** #197: notes suggested from checkpoints (optionally one commit's). */
  suggestions(path: string, commit?: string): Observable<{ items: MemorySuggestion[] }> {
    return this.http.get<{ items: MemorySuggestion[] }>(`/api/repos/${path}/memory-suggestions`, { params: commit ? { commit } : {} });
  }

  decide(path: string, id: string, decision: 'accept' | 'dismiss', edit?: { text?: string; tags?: string[] }): Observable<MemoryNote | { ok: true }> {
    return this.http.post<MemoryNote | { ok: true }>(`/api/repos/${path}/memory-suggestions/${id}/${decision}`, edit ?? {});
  }
}
