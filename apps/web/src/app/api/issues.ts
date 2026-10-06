import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Issue, IssueComment, IssueInput, IssueState, IssueType } from '@appmarket/shared';
import type { Observable } from 'rxjs';

export interface IssueFilters {
  state?: IssueState | 'all';
  type?: IssueType;
  /** A handle, or "agents". */
  assignee?: string;
}

/** #295: a repo's issues (#294). */
@Injectable({ providedIn: 'root' })
export class IssuesApi {
  private readonly http = inject(HttpClient);

  list(path: string, filters: IssueFilters = {}): Observable<{ items: Issue[]; counts: Partial<Record<IssueState, number>> }> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
    return this.http.get<{ items: Issue[]; counts: Partial<Record<IssueState, number>> }>(`/api/repos/${path}/issues`, { params });
  }

  get(path: string, number: number): Observable<Issue> {
    return this.http.get<Issue>(`/api/repos/${path}/issues/${number}`);
  }

  create(path: string, input: IssueInput): Observable<Issue> {
    return this.http.post<Issue>(`/api/repos/${path}/issues`, input);
  }

  update(path: string, number: number, input: IssueInput): Observable<Issue> {
    return this.http.patch<Issue>(`/api/repos/${path}/issues/${number}`, input);
  }

  comments(path: string, number: number): Observable<{ items: IssueComment[] }> {
    return this.http.get<{ items: IssueComment[] }>(`/api/repos/${path}/issues/${number}/comments`);
  }

  comment(path: string, number: number, body: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/repos/${path}/issues/${number}/comments`, { body });
  }

  deleteComment(path: string, number: number, id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`/api/repos/${path}/issues/${number}/comments/${id}`);
  }
}
