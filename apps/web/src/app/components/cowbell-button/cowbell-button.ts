import { ChangeDetectionStrategy, Component, PLATFORM_ID, effect, inject, input, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CowbellsApi } from '../../api/cowbells';
import { Auth } from '../../auth/auth';

/**
 * Ring a repo's cowbell (appmarket's GitHub stars). Signed-out visitors are sent to sign in and
 * back. The count from the page renders on the server; the user's own state loads in the browser.
 */
@Component({
  selector: 'app-cowbell-button',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, RouterLink],
  templateUrl: './cowbell-button.html',
  styleUrl: './cowbell-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CowbellButton {
  /** The repo's path, `owner/slug`. */
  readonly path = input.required<string>();
  readonly name = input.required<string>();
  /** The repo's count when the page was rendered. */
  readonly initialCount = input(0);

  protected readonly auth = inject(Auth);
  private readonly api = inject(CowbellsApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly count = signal(0);
  protected readonly cowbelled = signal(false);
  protected readonly busy = signal(false);
  protected readonly ringing = signal(false);

  constructor() {
    effect(() => {
      const initial = this.initialCount();
      untracked(() => this.count.set(initial));
    });
    // Once the session is known, load whether this user already rang it.
    effect(() => {
      if (!this.isBrowser || !this.auth.user()) return;
      const path = this.path();
      untracked(() => void this.refresh(path));
    });
  }

  private async refresh(path: string): Promise<void> {
    try {
      const status = await firstValueFrom(this.api.status(path));
      this.cowbelled.set(status.cowbelled);
      this.count.set(status.count);
    } catch {
      // Keep the rendered count; the button still works.
    }
  }

  protected async toggle(event: MouseEvent): Promise<void> {
    if (this.busy()) return;
    const on = !this.cowbelled();
    this.ringing.set(on && event.detail > 0);
    this.busy.set(true);
    // Optimistic: flip now, settle on the server's answer.
    this.cowbelled.set(on);
    this.count.update((n) => Math.max(0, n + (on ? 1 : -1)));
    try {
      const status = await firstValueFrom(this.api.set(this.path(), on));
      this.cowbelled.set(status.cowbelled);
      this.count.set(status.count);
    } catch {
      this.ringing.set(false);
      this.cowbelled.set(!on);
      this.count.update((n) => Math.max(0, n + (on ? -1 : 1)));
    } finally {
      this.busy.set(false);
    }
  }
}
