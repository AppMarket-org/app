import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ContributionCalendar, OrgCreate, OrgMember, OrgMemberInput, OrgMembership, OrgRole, Owner, OwnerProfile, OwnerProfileUpdate, Repo, SessionInfo } from '@appmarket/shared';
import { type Observable, map } from 'rxjs';

/** A profile: users list their public organizations, organizations their public members. */
export interface OwnerPage {
  owner: Owner;
  profile: OwnerProfile | null;
  repos: Repo[];
  orgs?: Owner[];
  people?: Owner[];
  /** #142: pinned repos, or (pinnedFallback) the most-cowbelled public ones. */
  pinned: Repo[];
  pinnedFallback: boolean;
  /** #144: users only, loaded with the page. */
  contributions?: ContributionCalendar;
}

/** #102: users and organizations (handles, owner pages, members). */
@Injectable({ providedIn: 'root' })
export class OwnersApi {
  private readonly http = inject(HttpClient);

  /** Public owner page: the user or org, its profile and its public repos. */
  page(handle: string): Observable<OwnerPage> {
    return this.http.get<OwnerPage>(`/api/owners/${encodeURIComponent(handle)}`);
  }

  /** #139: the profile of the signed-in user, or of an organization (owners only). */
  profile(org?: string): Observable<{ owner: Owner; profile: OwnerProfile }> {
    return this.http.get<{ owner: Owner; profile: OwnerProfile }>(org ? `/api/orgs/${org}/profile` : '/api/me/profile');
  }

  /** #144: a user's contribution calendar for a year, or the last 12 months. */
  contributions(handle: string, year?: number | null): Observable<ContributionCalendar> {
    return this.http.get<ContributionCalendar>(`/api/owners/${encodeURIComponent(handle)}/contributions`, { params: year ? { year } : {} });
  }

  /** #142: current pins and what may be pinned, for the signed-in user or an organization (owners). */
  pins(org?: string): Observable<{ pinned: Repo[]; candidates: Repo[] }> {
    return this.http.get<{ pinned: Repo[]; candidates: Repo[] }>(org ? `/api/orgs/${org}/pins` : '/api/me/pins');
  }

  savePins(repos: string[], org?: string): Observable<{ pinned: Repo[] }> {
    return this.http.put<{ pinned: Repo[] }>(org ? `/api/orgs/${org}/pins` : '/api/me/pins', { repos });
  }

  /** #140: upload (already cropped) or remove the picture of the signed-in user, or of an organization. */
  setAvatar(image: Blob, org?: string): Observable<{ owner: Owner }> {
    return this.http.put<{ owner: Owner }>(org ? `/api/orgs/${org}/avatar` : '/api/me/avatar', image, { headers: { 'Content-Type': image.type || 'application/octet-stream' } });
  }

  removeAvatar(org?: string): Observable<{ owner: Owner }> {
    return this.http.delete<{ owner: Owner }>(org ? `/api/orgs/${org}/avatar` : '/api/me/avatar');
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

  members(handle: string): Observable<{ org: Owner; role: OrgRole; public: boolean; members: OrgMember[] }> {
    return this.http.get<{ org: Owner; role: OrgRole; public: boolean; members: OrgMember[] }>(`/api/orgs/${handle}/members`);
  }

  /** #141: show or hide your membership on the organization's profile and yours. */
  setMembershipPublic(handle: string, visible: boolean): Observable<{ public: boolean }> {
    return this.http.put<{ public: boolean }>(`/api/orgs/${handle}/membership`, { public: visible });
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
