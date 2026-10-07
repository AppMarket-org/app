import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface GraphSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
  exported: boolean;
}

/** The code graph of a repo's default branch (owners and members). */
export interface CodeGraphMap {
  commit: string;
  branch: string;
  files: { path: string; symbols: number }[];
  edges: [string, string][];
  /** False when the repo is larger than the indexing limits. */
  complete: boolean;
  indexedAt: string;
}

export interface CodeGraphFile {
  commit: string;
  branch: string;
  path: string;
  symbols: GraphSymbol[];
  imports: string[];
  importedBy: string[];
  impact: { path: string; depth: number; via: string }[];
}

/** #240: the code graph agents use, for people: a map of the repo and one file's neighbourhood. */
@Injectable({ providedIn: 'root' })
export class CodeGraphApi {
  private readonly http = inject(HttpClient);

  map(path: string): Observable<CodeGraphMap> {
    return this.http.get<CodeGraphMap>(`/api/repos/${path}/code-graph/map`);
  }

  file(path: string, file: string): Observable<CodeGraphFile> {
    return this.http.get<CodeGraphFile>(`/api/repos/${path}/code-graph/file`, { params: { path: file } });
  }

  symbols(path: string, q: string): Observable<{ commit: string; symbols: GraphSymbol[] }> {
    return this.http.get<{ commit: string; symbols: GraphSymbol[] }>(`/api/repos/${path}/code-graph/symbols`, { params: { q } });
  }
}
