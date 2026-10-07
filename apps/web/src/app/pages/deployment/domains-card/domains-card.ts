import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HOSTNAME, type WorkerDomain } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

const message = (error: unknown) => (error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined);

/**
 * #39 (D9): attach a hostname from the buyer's own zones to the deployed Worker as a Workers
 * Custom Domain. Cloudflare creates the DNS record and certificate.
 */
@Component({
  selector: 'app-domains-card',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatChipsModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule],
  templateUrl: './domains-card.html',
  styleUrl: './domains-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainsCard {
  readonly deploymentId = input.required<string>();
  /** The Worker's domains, after each load from Cloudflare (the page's address follows). */
  readonly loaded = output<string[]>();
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  /** null when the connection cannot list zones: type the full hostname. */
  protected readonly zones = signal<{ id: string; name: string }[] | null>(null);
  protected readonly domains = signal<WorkerDomain[] | null>(null);
  protected readonly active = signal<Record<string, boolean>>({});
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly zoneId = signal('');
  protected readonly name = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly hostname = computed(() => {
    const zone = this.zones()?.find((z) => z.id === this.zoneId());
    const name = this.name().trim().toLowerCase().replace(/\.$/, '');
    if (this.zones() && !zone) return '';
    return zone ? (name ? `${name}.${zone.name}` : zone.name) : name;
  });
  protected readonly valid = computed(() => HOSTNAME.test(this.hostname()));

  constructor() {
    const timer = setInterval(() => void this.checkPending(), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async attach(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post(`/api/deployments/${this.deploymentId()}/domains`, { hostname: this.hostname(), zoneId: this.zoneId() || undefined }));
      this.snackBar.open(`${this.hostname()} attached. The certificate can take a few minutes.`, undefined, { duration: 5000 });
      this.name.set('');
      this.zoneId.set('');
      await this.load();
    } catch (error) {
      this.error.set(message(error) ?? 'Could not attach the domain.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async detach(d: WorkerDomain): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: `Detach ${d.hostname}?`, message: 'The app stops answering on this hostname and its DNS record is removed. Cloudflare keeps the certificate it issued; delete it under SSL/TLS › Edge Certificates if you no longer need it.', confirm: 'Detach' },
          width: '30rem',
        })
        .afterClosed(),
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/deployments/${this.deploymentId()}/domains/${d.id}`));
      await this.load();
    } catch (error) {
      this.snackBar.open(message(error) ?? 'Could not detach the domain.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ zones: { id: string; name: string }[] | null; domains: WorkerDomain[] }>(`/api/deployments/${this.deploymentId()}/domains`));
      this.zones.set(r.zones);
      this.domains.set(r.domains);
      this.loaded.emit(r.domains.map((d) => d.hostname));
      this.loadError.set(null);
      await this.checkPending();
    } catch (error) {
      this.loadError.set(message(error) ?? 'Could not load domains from Cloudflare.');
    }
  }

  private async checkPending(): Promise<void> {
    for (const d of this.domains() ?? []) {
      if (this.active()[d.id]) continue;
      const s = await firstValueFrom(this.http.get<{ active: boolean }>(`/api/deployments/${this.deploymentId()}/domains/${d.id}/status`)).catch(() => null);
      if (s) this.active.update((a) => ({ ...a, [d.id]: s.active }));
    }
  }
}
