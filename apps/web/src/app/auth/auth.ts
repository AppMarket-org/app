import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { OrgMembership, Owner, Role } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';

export type Provider = 'google' | 'github';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

/** Session state and Google/GitHub sign-in via the API's Better Auth routes (PRD R11). */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly current = signal<CurrentUser | null | undefined>(undefined);

  /** undefined while loading, null when signed out. */
  readonly user = this.current.asReadonly();
  readonly signedIn = computed(() => !!this.current());
  /** #102: the user's handle and organizations, once loaded. */
  readonly owner = signal<Owner | null>(null);
  readonly orgs = signal<OrgMembership[]>([]);
  private loading: Promise<CurrentUser | null> | undefined;

  /** Loads the session once; signed-in pages are client-rendered, so the server never needs it. */
  load(): Promise<CurrentUser | null> {
    if (!this.isBrowser) return Promise.resolve(null);
    if (this.current() !== undefined) return Promise.resolve(this.current()!);
    return this.loading ??= this.loadSession().finally(() => { this.loading = undefined; });
  }

  private async loadSession(): Promise<CurrentUser | null> {
    try {
      // get-session answers 200 with null when signed out (no 401 noise in the console).
      const session = await firstValueFrom(this.http.get<{ user: CurrentUser } | null>('/api/auth/get-session'));
      this.current.set(
        session ? { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null, role: session.user.role } : null,
      );
    } catch {
      this.current.set(null);
    }
    if (this.current()) this.refreshOwner();
    return this.current()!;
  }

  /** Reloads the user's handle and organizations (after a rename or a new org). */
  refreshOwner(): void {
    this.http.get<{ owner: Owner; orgs: OrgMembership[] }>('/api/me/owner').subscribe({
      next: ({ owner, orgs }) => {
        this.owner.set(owner);
        this.orgs.set(orgs);
      },
      error: () => undefined,
    });
  }

  /** Starts the OAuth flow; the browser leaves the app for Google or GitHub. */
  async signIn(provider: Provider, captchaToken: string, callbackURL = '/dashboard'): Promise<void> {
    const { url } = await firstValueFrom(
      this.http.post<{ url: string }>(
        '/api/auth/sign-in/social',
        { provider, callbackURL },
        { headers: { 'x-captcha-response': captchaToken } },
      ),
    );
    window.location.assign(url);
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}));
    this.current.set(null);
    this.owner.set(null);
    this.orgs.set([]);
  }
}
