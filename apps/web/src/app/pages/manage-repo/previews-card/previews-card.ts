import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { BranchPreview, CloudflareAccount, PreviewSettings } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CloudflareApi } from '../../../api/cloudflare';

/** #28 (R8): a live preview of every branch, deployed into the developer's own Cloudflare account. */
@Component({
  selector: 'app-previews-card',
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatListModule, MatSelectModule, MatSlideToggleModule],
  templateUrl: './previews-card.html',
  styleUrl: './previews-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewsCard {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly cloudflare = inject(CloudflareApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly settings = signal<PreviewSettings | null | undefined>(undefined);
  protected readonly previews = signal<BranchPreview[]>([]);
  /** null when the user has to connect Cloudflare first. */
  protected readonly accounts = signal<CloudflareAccount[] | null | undefined>(undefined);
  protected readonly accountId = signal('');
  protected readonly busy = signal(false);
  protected readonly short = (sha: string) => sha.slice(0, 7);
  protected connectUrl = '';

  constructor() {
    const timer = setInterval(() => {
      if (this.settings()?.enabled) void this.load();
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    this.connectUrl = this.cloudflare.connectUrl(`/dashboard/repos/${this.path()}`);
    void this.load();
  }

  protected async toggle(enabled: boolean): Promise<void> {
    if (enabled && !this.accounts()) await this.loadAccounts();
    if (enabled && !this.accountId()) {
      const only = this.accounts()?.length === 1 ? this.accounts()![0]!.id : '';
      if (!only) {
        // Pick an account first; the toggle turns on when one is chosen.
        this.settings.set({ enabled: false, accountId: '', connectedBy: '', mine: true });
        return;
      }
      this.accountId.set(only);
    }
    await this.save(enabled);
  }

  protected async chooseAccount(id: string): Promise<void> {
    this.accountId.set(id);
    await this.save(true);
  }

  protected async loadAccounts(): Promise<void> {
    try {
      const accounts = await firstValueFrom(this.cloudflare.accounts());
      this.accounts.set(accounts);
    } catch {
      this.accounts.set(null);
    }
  }

  private async save(enabled: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.put(`/api/repos/${this.path()}/previews`, { enabled, accountId: enabled ? this.accountId() : undefined }));
      this.snackBar.open(enabled ? 'Previews on. Push a branch to deploy it.' : 'Previews off', undefined, { duration: 4000 });
      await this.load();
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null)?.error : undefined;
      if (code === 'not_connected' || code === 'reconnect') this.accounts.set(null);
      else this.snackBar.open('Could not change previews.', 'OK', { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ settings: PreviewSettings | null; items: BranchPreview[] }>(`/api/repos/${this.path()}/previews`)).catch(() => null);
    if (!r) return;
    this.settings.set(r.settings);
    this.previews.set(r.items);
    if (r.settings?.accountId) this.accountId.set(r.settings.accountId);
  }
}
