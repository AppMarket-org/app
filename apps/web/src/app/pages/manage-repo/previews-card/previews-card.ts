import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { BranchPreview, CloudflareAccount, PreviewSettings } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CloudflareApi } from '../../../api/cloudflare';

const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * #28 (R8), #37 (D7): deploy from this repo into your own Cloudflare account: the default branch
 * on every push (to a Worker you choose) and previews of other branches.
 */
@Component({
  selector: 'app-previews-card',
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatSelectModule, MatSlideToggleModule],
  templateUrl: './previews-card.html',
  styleUrl: './previews-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewsCard {
  readonly path = input.required<string>();
  /** Default Worker name for the default branch. */
  readonly slug = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly cloudflare = inject(CloudflareApi);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly settings = signal<PreviewSettings | null | undefined>(undefined);
  protected readonly deploys = signal<BranchPreview[]>([]);
  /** null when the user has to connect Cloudflare first. */
  protected readonly accounts = signal<CloudflareAccount[] | null | undefined>(undefined);
  protected readonly busy = signal(false);
  protected readonly short = (sha: string) => sha.slice(0, 7);
  protected connectUrl = '';

  // Form state.
  protected readonly deployDefault = signal(false);
  protected readonly previews = signal(false);
  protected readonly workerName = signal('');
  protected readonly accountId = signal('');
  protected readonly workerNameValid = computed(() => WORKER_NAME.test(this.workerName()));
  protected readonly canSave = computed(() => !this.busy() && (!(this.deployDefault() || this.previews()) || (!!this.accountId() && (!this.deployDefault() || this.workerNameValid()))));

  constructor() {
    const timer = setInterval(() => {
      const s = this.settings();
      if (s?.enabled || s?.deployDefault) void this.load();
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    this.connectUrl = this.cloudflare.connectUrl(`/dashboard/repos/${this.path()}`);
    void this.load(true);
    void this.loadAccounts();
  }

  protected async save(): Promise<void> {
    const on = this.deployDefault() || this.previews();
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.put(`/api/repos/${this.path()}/previews`, {
          enabled: this.previews(),
          deployDefault: this.deployDefault(),
          workerName: this.deployDefault() ? this.workerName() : undefined,
          accountId: on ? this.accountId() : undefined,
        }),
      );
      this.snackBar.open(on ? 'Saved. Your next push deploys.' : 'Automatic deploys off', undefined, { duration: 4000 });
      await this.load(true);
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? (error.error as { error?: string; message?: string } | null) : null;
      if (body?.error === 'not_connected' || body?.error === 'reconnect') this.accounts.set(null);
      else this.snackBar.open(body?.message ?? 'Could not save.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async turnOff(): Promise<void> {
    this.deployDefault.set(false);
    this.previews.set(false);
    await this.save();
  }

  private async loadAccounts(): Promise<void> {
    try {
      const accounts = await firstValueFrom(this.cloudflare.accounts());
      this.accounts.set(accounts);
      if (!this.accountId() && accounts.length === 1) this.accountId.set(accounts[0]!.id);
    } catch {
      this.accounts.set(null);
    }
  }

  /** `form`: also reset the form to the saved settings. */
  private async load(form = false): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ settings: PreviewSettings | null; items: BranchPreview[] }>(`/api/repos/${this.path()}/previews`)).catch(() => null);
    if (!r) return;
    this.settings.set(r.settings);
    this.deploys.set(r.items);
    if (form) {
      this.previews.set(!!r.settings?.enabled);
      this.deployDefault.set(!!r.settings?.deployDefault);
      this.workerName.set(r.settings?.workerName ?? this.slug());
      if (r.settings?.accountId) this.accountId.set(r.settings.accountId);
    }
  }
}
