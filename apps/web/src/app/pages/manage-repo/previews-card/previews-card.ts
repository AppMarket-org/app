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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import type { BranchPreview, CloudflareAccount, PreviewSettings } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CloudflareApi } from '../../../api/cloudflare';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * #28 (R8), #37 (D7): deploy from this repo into your own Cloudflare account. Deploy starts the
 * first deploy of the default branch; once it is deployed, its settings (redeploy on every push,
 * previews of other branches) are saved with Save.
 */
@Component({
  selector: 'app-previews-card',
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule],
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
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly settings = signal<PreviewSettings | null | undefined>(undefined);
  protected readonly deploys = signal<(BranchPreview & { branchExists?: boolean })[]>([]);
  /** null when the user has to connect Cloudflare first. */
  protected readonly accounts = signal<CloudflareAccount[] | null | undefined>(undefined);
  /** appmarket.org cannot deploy to Cloudflare yet (its OAuth client is not set up). */
  protected readonly unavailable = signal(false);
  protected readonly busy = signal(false);
  protected readonly short = (sha: string) => sha.slice(0, 7);
  protected connectUrl = '';

  // Form state.
  protected readonly deployDefault = signal(true);
  protected readonly previews = signal(false);
  protected readonly workerName = signal('');
  protected readonly accountId = signal('');
  protected readonly workerNameValid = computed(() => WORKER_NAME.test(this.workerName()));
  protected readonly accountName = computed(() => this.accounts()?.find((a) => a.id === this.accountId())?.name ?? '');

  /** The default branch's deploy to its Worker; null until the repo is first deployed. */
  protected readonly live = computed(() => {
    const worker = this.settings()?.workerName;
    return (worker && this.deploys().find((p) => p.workerName === worker && !p.deleted)) || null;
  });
  protected readonly branchPreviews = computed(() => this.deploys().filter((p) => p.workerName !== this.settings()?.workerName));
  protected readonly canDeploy = computed(() => !this.busy() && !!this.accountId() && this.workerNameValid());
  protected readonly canSave = computed(() => !this.busy() && (!(this.deployDefault() || this.previews()) || (!!this.accountId() && this.workerNameValid())));
  protected readonly dirty = computed(() => {
    const s = this.settings();
    return !s || s.deployDefault !== this.deployDefault() || s.enabled !== this.previews() || (s.workerName ?? this.slug()) !== this.workerName() || s.accountId !== this.accountId();
  });

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

  /** Deploys the default branch's latest commit now, with these settings, and opens the deployment. */
  protected async deploy(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(
        this.http.post<{ id: string; already: boolean }>(`/api/repos/${this.path()}/previews/deploy`, {
          accountId: this.accountId(),
          workerName: this.workerName(),
          deployDefault: this.deployDefault(),
          previews: this.previews(),
        }),
      );
      if (r.already) this.snackBar.open('A deploy is already running', undefined, { duration: 4000 });
      await this.router.navigate(['/dashboard/deployments', r.id]);
    } catch (error) {
      this.fail(error, 'Could not start the deploy.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    const on = this.deployDefault() || this.previews();
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.put(`/api/repos/${this.path()}/previews`, {
          enabled: this.previews(),
          deployDefault: this.deployDefault(),
          workerName: this.workerName(),
          accountId: on ? this.accountId() : undefined,
        }),
      );
      this.snackBar.open('Saved', undefined, { duration: 3000 });
      await this.load(true);
    } catch (error) {
      this.fail(error, 'Could not save.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async deletePreview(p: BranchPreview): Promise<void> {
    const extra = p.resources.length ? ` It also created ${p.resources.join(', ')}; those stay in your account until you delete them in the Cloudflare dashboard.` : '';
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: `Delete the preview of ${p.branch}?`, message: `The Worker ${p.workerName} is deleted from your Cloudflare account. A new push to the branch deploys it again.${extra}`, confirm: 'Delete Worker' },
          width: '32rem',
        })
        .afterClosed(),
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/repos/${this.path()}/previews/${p.deploymentId}`));
      this.snackBar.open(`Preview of ${p.branch} deleted`, undefined, { duration: 4000 });
      await this.load();
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
      this.snackBar.open(message ?? 'Could not delete the preview.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async turnOff(): Promise<void> {
    this.deployDefault.set(false);
    this.previews.set(false);
    await this.save();
  }

  private fail(error: unknown, fallback: string): void {
    const body = error instanceof HttpErrorResponse ? (error.error as { error?: string; message?: string } | null) : null;
    if (body?.error === 'not_connected' || body?.error === 'reconnect') this.accounts.set(null);
    else this.snackBar.open(body?.message ?? fallback, 'OK', { duration: 5000 });
  }

  private async loadAccounts(): Promise<void> {
    try {
      const accounts = await firstValueFrom(this.cloudflare.accounts());
      this.accounts.set(accounts);
      if (!this.accountId() && accounts.length === 1) this.accountId.set(accounts[0]!.id);
    } catch (e) {
      this.unavailable.set(e instanceof HttpErrorResponse && (e.error as { error?: string } | null)?.error === 'unavailable');
      this.accounts.set(null);
    }
  }

  /** `form`: also reset the form to the saved settings. */
  private async load(form = false): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ settings: PreviewSettings | null; items: (BranchPreview & { branchExists?: boolean })[] }>(`/api/repos/${this.path()}/previews`)).catch(() => null);
    if (!r) return;
    this.settings.set(r.settings);
    this.deploys.set(r.items);
    if (form && r.settings) {
      this.previews.set(r.settings.enabled);
      this.deployDefault.set(r.settings.deployDefault);
      this.workerName.set(r.settings.workerName ?? this.slug());
      this.accountId.set(r.settings.accountId);
    } else if (form) {
      this.workerName.set(this.slug());
    }
  }
}
