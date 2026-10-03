import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { OrgCreate, OrgMember, OrgMemberInput, OrgMembership, OrgRole, Owner, Repo } from '@appmarket/shared';
import type { Observable } from 'rxjs';

/** #102: users and organizations (handles, owner pages, members). */
@Injectable({ providedIn: 'root' })
export class OwnersApi {
  private readonly http = inject(HttpClient);

  /** Public owner page: the user or org and its public repos. */
  page(handle: string): Observable<{ owner: Owner; repos: Repo[] }> {
    return this.http.get<{ owner: Owner; repos: Repo[] }>(`/api/owners/${encodeURIComponent(handle)}`);
  }

  me(): Observable<{ owner: Owner; orgs: OrgMembership[] }> {
    return this.http.get<{ owner: Owner; orgs: OrgMembership[] }>('/api/me/owner');
  }

  setHandle(handle: string): Observable<Owner> {
    return this.http.patch<Owner>('/api/me/handle', { handle });
  }

  createOrg(org: OrgCreate): Observable<Owner> {
    return this.http.post<Owner>('/api/orgs', org);
  }

  updateOrg(handle: string, change: { handle?: string; name?: string }): Observable<Owner> {
    return this.http.patch<Owner>(`/api/orgs/${handle}`, change);
  }

  members(handle: string): Observable<{ org: Owner; role: OrgRole; members: OrgMember[] }> {
    return this.http.get<{ org: Owner; role: OrgRole; members: OrgMember[] }>(`/api/orgs/${handle}/members`);
  }

  setMember(handle: string, member: OrgMemberInput): Observable<{ members: OrgMember[] }> {
    return this.http.put<{ members: OrgMember[] }>(`/api/orgs/${handle}/members`, member);
  }

  removeMember(handle: string, member: string): Observable<{ members: OrgMember[] }> {
    return this.http.delete<{ members: OrgMember[] }>(`/api/orgs/${handle}/members/${member}`);
  }
}
