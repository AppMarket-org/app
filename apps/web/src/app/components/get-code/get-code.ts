import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { GitToken } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Catalog } from '../../api/catalog';
import { Auth } from '../../auth/auth';

/**
 * PRD R3/D11: signed-in users get a one-hour read token and a ready clone command. The token is
 * shown once and only kept in memory.
 */
@Component({
  selector: 'app-get-code',
  imports: [MatButtonModule, MatProgressBarModule, RouterLink],
  templateUrl: './get-code.html',
  styleUrl: './get-code.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetCode {
  /** The repo's path, `owner/slug`. */
  readonly path = input.required<string>();

  protected readonly auth = inject(Auth);
  private readonly catalog = inject(Catalog);
  protected readonly token = signal<GitToken | null>(null);
  protected readonly error = signal(false);
  protected readonly pending = signal(false);
  protected readonly command = computed(() => {
    const t = this.token();
    return t ? `git -c http.extraHeader="Authorization: Bearer ${t.token}" clone ${t.remote}` : '';
  });

  protected async mint(): Promise<void> {
    this.error.set(false);
    this.pending.set(true);
    try {
      this.token.set(await firstValueFrom(this.catalog.readToken(this.path())));
    } catch {
      this.error.set(true);
    } finally {
      this.pending.set(false);
    }
  }
}
