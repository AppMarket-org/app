import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { RepoWebhook } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';

/**
 * #34: push webhooks to the developer's own CI. A generic endpoint gets signed JSON; GitHub gets a
 * repository_dispatch event that starts a GitHub Actions workflow. Each delivery carries a
 * one-hour read token to clone the code.
 */
@Component({
  selector: 'app-webhooks-card',
  imports: [DatePipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule],
  templateUrl: './webhooks-card.html',
  styleUrl: './webhooks-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebhooksCard {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly hooks = signal<RepoWebhook[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly adding = signal(false);
  protected readonly format = signal<'generic' | 'github'>('github');
  protected readonly url = signal('');
  protected readonly githubToken = signal('');
  /** Shown once after creating a generic webhook. */
  protected readonly secret = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async add(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await firstValueFrom(
        this.http.post<{ secret: string | null }>(`/api/repos/${this.path()}/webhooks`, { format: this.format(), url: this.url().trim(), githubToken: this.format() === 'github' ? this.githubToken().trim() : undefined }),
      );
      this.secret.set(created.secret);
      this.githubToken.set('');
      this.url.set('');
      this.adding.set(false);
      await this.load();
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? (error.error as { message?: string; issues?: { message: string }[] } | null) : null;
      this.error.set(body?.issues?.[0]?.message ?? body?.message ?? 'Could not add the webhook.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(hook: RepoWebhook): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/repos/${this.path()}/webhooks/${hook.id}`));
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  protected copySecret(): void {
    const s = this.secret();
    if (s) this.snackBar.open(this.clipboard.copy(s) ? 'Secret copied' : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }

  private async load(): Promise<void> {
    this.hooks.set((await firstValueFrom(this.http.get<{ items: RepoWebhook[] }>(`/api/repos/${this.path()}/webhooks`)).catch(() => ({ items: [] }))).items);
  }
}
