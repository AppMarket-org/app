import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ActivityPage, ContributionCalendar, OrgCreate, OrgMember, OrgMemberInput, OrgMembership, OrgRole, Owner, OwnerPrivacy, OwnerProfile, OwnerProfileUpdate, Repo, SessionInfo, CommitEntry } from '@appmarket/shared';
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
  profile(org?: string): Observable<{ owner: Owner; profile: OwnerProfile; privacy: OwnerPrivacy }> {
    return this.http.get<{ owner: Owner; profile: OwnerProfile; privacy: OwnerPrivacy }>(org ? `/api/orgs/${org}/profile` : '/api/me/profile');
  }

  /** #144: a user's contribution calendar for a year, or the last 12 months. */
  contributions(handle: string, year?: number | null): Observable<ContributionCalendar> {
    return this.http.get<ContributionCalendar>(`/api/owners/${encodeURIComponent(handle)}/contributions`, { params: year ? { year } : {} });
  }

  /** #145: activity by month (a year, or the last 12 months), older pages with `before`. */
  /** A user's commits in one repo in one month, with the prompts the viewer may see. */
  commits(handle: string, repo: string, month: string): Observable<{ items: CommitEntry[]; total: number }> {
    return this.http.get<{ items: CommitEntry[]; total: number }>(`/api/owners/${encodeURIComponent(handle)}/commits`, { params: { repo, month } });
  }

  activity(handle: string, year?: number | null, before?: string | null): Observable<ActivityPage> {
    const params: Record<string, string> = {};
    if (year) params['year'] = String(year);
    if (before) params['before'] = before;
    return this.http.get<ActivityPage>(`/api/owners/${encodeURIComponent(handle)}/activity`, { params });
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

  updateProfile(update: OwnerProfileUpdate, org?: string): Observable<{ owner: Owner; profile: OwnerProfile; privacy: OwnerPrivacy }> {
    return this.http.patch<{ owner: Owner; profile: OwnerProfile; privacy: OwnerPrivacy }>(org ? `/api/orgs/${org}/profile` : '/api/me/profile', update);
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
  /** #134: a labelled CI token; the token is returned once. */
  createCiToken(label: string): Observable<{ token: string; label: string; expiresAt: string }> {
    return this.http.post<{ token: string; label: string; expiresAt: string }>('/api/me/sessions/ci', { label });
  }

  /** #133 */
  renameSession(id: string, name: string): Observable<{ name: string }> {
    return this.http.patch<{ name: string }>(`/api/me/sessions/${id}`, { name });
  }

  sessions(): Observable<SessionInfo[]> {
    return this.http.get<{ items: SessionInfo[] }>('/api/me/sessions').pipe(map((r) => r.items));
  }

  revokeSession(id: string): Observable<unknown> {
    return this.http.delete(`/api/me/sessions/${id}`);
  }
}
