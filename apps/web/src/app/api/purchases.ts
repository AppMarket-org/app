import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * #212/#213: whether the signed-in user owns a paid app, shared by the app page's deploy action
 * and downloads. Loaded in the browser only (public pages are cached for everyone).
 */
@Injectable({ providedIn: 'root' })
export class Purchases {
  private readonly http = inject(HttpClient);
  /** owner/slug → owns (or edits) the app. */
  readonly owned = signal<Record<string, boolean>>({});

  async load(path: string): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ owned: boolean }>(`/api/repos/${path}/ownership`)).catch(() => null);
    if (r) this.owned.update((o) => ({ ...o, [path]: r.owned }));
  }

  /** After Stripe Checkout returns: records the purchase without waiting for the webhook. */
  async confirm(path: string, sessionId: string): Promise<boolean> {
    const r = await firstValueFrom(this.http.post<{ owned: boolean }>(`/api/repos/${path}/checkout/confirm`, { sessionId })).catch(() => null);
    if (r) this.owned.update((o) => ({ ...o, [path]: r.owned }));
    return !!r?.owned;
  }

  /** Goes to Stripe Checkout. */
  async buy(path: string): Promise<string | null> {
    try {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>(`/api/repos/${path}/checkout`, {}));
      window.location.assign(url);
      return null;
    } catch (error) {
      return (error as { error?: { message?: string } })?.error?.message ?? 'Checkout could not start. Try again.';
    }
  }
}
