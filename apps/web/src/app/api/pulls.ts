import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { PullComment, PullRequest, PullReview, PullState } from '@appmarket/shared';
import type { Observable } from 'rxjs';

export interface PullCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface PullFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  tooLarge: boolean;
}

export interface PullFiles {
  base: string;
  head: string;
  commits: PullCommit[];
  files: PullFile[];
  truncated: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  status: PullFile['status'];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
  tooLarge: boolean;
}

export interface PullSources {
  sources: { repo: string; fork: boolean; session: boolean; defaultBranch: string; branches: string[] }[];
  target: { defaultBranch: string; branches: string[] };
}

/** #256–#259: pull requests. `path` is owner/slug of the target repo. */
@Injectable({ providedIn: 'root' })
export class PullsApi {
  private readonly http = inject(HttpClient);

  list(path: string, state: PullState | 'all'): Observable<{ items: PullRequest[]; counts: Partial<Record<PullState, number>> }> {
    return this.http.get<{ items: PullRequest[]; counts: Partial<Record<PullState, number>> }>(`/api/repos/${path}/pulls`, { params: { state } });
  }

  get(path: string, n: number): Observable<PullRequest> {
    return this.http.get<PullRequest>(`/api/repos/${path}/pulls/${n}`);
  }

  open(path: string, input: { title: string; body: string; source: string; sourceBranch: string; targetBranch: string }): Observable<PullRequest> {
    return this.http.post<PullRequest>(`/api/repos/${path}/pulls`, input);
  }

  update(path: string, n: number, change: { title?: string; body?: string; state?: 'open' | 'closed' }): Observable<PullRequest> {
    return this.http.patch<PullRequest>(`/api/repos/${path}/pulls/${n}`, change);
  }

  merge(path: string, n: number): Observable<PullRequest> {
    return this.http.post<PullRequest>(`/api/repos/${path}/pulls/${n}/merge`, {});
  }

  files(path: string, n: number): Observable<PullFiles> {
    return this.http.get<PullFiles>(`/api/repos/${path}/pulls/${n}/files`);
  }

  diff(path: string, n: number, file: string): Observable<FileDiff> {
    return this.http.get<FileDiff>(`/api/repos/${path}/pulls/${n}/diff`, { params: { path: file } });
  }

  conversation(path: string, n: number): Observable<{ comments: PullComment[]; reviews: PullReview[] }> {
    return this.http.get<{ comments: PullComment[]; reviews: PullReview[] }>(`/api/repos/${path}/pulls/${n}/comments`);
  }

  comment(path: string, n: number, input: { body: string; path?: string; line?: number; side?: 'old' | 'new' }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/repos/${path}/pulls/${n}/comments`, input);
  }

  editComment(path: string, n: number, id: string, body: string): Observable<unknown> {
    return this.http.patch(`/api/repos/${path}/pulls/${n}/comments/${id}`, { body });
  }

  deleteComment(path: string, n: number, id: string): Observable<unknown> {
    return this.http.delete(`/api/repos/${path}/pulls/${n}/comments/${id}`);
  }

  review(path: string, n: number, event: 'comment' | 'approve' | 'request_changes', body: string): Observable<PullRequest> {
    return this.http.post<PullRequest>(`/api/repos/${path}/pulls/${n}/reviews`, { event, body });
  }

  sources(path: string): Observable<PullSources> {
    return this.http.get<PullSources>(`/api/repos/${path}/pulls/sources`);
  }

  compare(path: string, q: { source: string; branch: string; target: string }): Observable<PullFiles> {
    return this.http.get<PullFiles>(`/api/repos/${path}/compare`, { params: q });
  }
}
