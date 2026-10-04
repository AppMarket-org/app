import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { OrgCreate, OrgMember, OrgMemberInput, OrgMembership, OrgRole, Owner, OwnerProfile, OwnerProfileUpdate, Repo, SessionInfo } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** #102: users and organizations (handles, owner pages, members). */
@Injectable({ providedIn: 'root' })
export class OwnersApi {
  private readonly http = inject(HttpClient);

  /** Public owner page: the user or org, its profile and its public repos. */
  page(handle: string): Observable<{ owner: Owner; profile: OwnerProfile | null; repos: Repo[] }> {
    return this.http.get<{ owner: Owner; profile: OwnerProfile | null; repos: Repo[] }>(`/api/owners/${encodeURIComponent(handle)}`);
  }

  /** #139: the profile of the signed-in user, or of an organization (owners only). */
  profile(org?: string): Observable<{ owner: Owner; profile: OwnerProfile }> {
    return this.http.get<{ owner: Owner; profile: OwnerProfile }>(org ? `/api/orgs/${org}/profile` : '/api/me/profile');
  }

  updateProfile(update: OwnerProfileUpdate, org?: string): Observable<{ owner: Owner; profile: OwnerProfile }> {
    return this.http.patch<{ owner: Owner; profile: OwnerProfile }>(org ? `/api/orgs/${org}/profile` : '/api/me/profile', update);
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

  /** #104: browsers and device logins signed in to this account. */
  sessions(): Observable<SessionInfo[]> {
    return this.http.get<{ items: SessionInfo[] }>('/api/me/sessions').pipe(map((r) => r.items));
  }

  revokeSession(id: string): Observable<unknown> {
    return this.http.delete(`/api/me/sessions/${id}`);
  }
}
