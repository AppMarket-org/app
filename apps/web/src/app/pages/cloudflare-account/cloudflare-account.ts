import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CloudflareAccount, CloudflareConnection } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CloudflareApi } from '../../api/cloudflare';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { Seo } from '../../seo/seo';

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the connection on Cloudflare.',
  unavailable: 'Deploying to Cloudflare is not available on appmarket.org yet.',
  invalid_state: 'That sign-in link expired. Try connecting again.',
  wrong_user: 'The connection was started by a different appmarket.org account.',
  exchange_failed: 'Cloudflare did not accept the connection. Try again.',
};

/** PRD D5: connect a Cloudflare account so appmarket.org can deploy apps into it. */
@Component({
  selector: 'app-cloudflare-account',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatDialogModule, MatIconModule, MatListModule, MatProgressBarModule, MatSnackBarModule, RouterLink],
  templateUrl: './cloudflare-account.html',
  styleUrl: './cloudflare-account.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloudflareAccountPage {
  private readonly api = inject(CloudflareApi);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);

  protected readonly connection = signal<CloudflareConnection | null>(null);
  protected readonly accounts = signal<CloudflareAccount[] | null>(null);
  protected readonly needsReconnect = signal(false);
  protected readonly busy = signal(false);
  protected readonly connectUrl = this.api.connectUrl('/dashboard/cloudflare');

  constructor() {
    inject(Seo).set({ title: 'Cloudflare account', description: 'Connect your Cloudflare account.', path: '/dashboard/cloudflare', noindex: true });
  }

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('connected')) this.snackBar.open('Cloudflare account connected', undefined, { duration: 4000 });
    const error = q.get('error');
    if (error) this.snackBar.open(ERRORS[error] ?? 'Could not connect your Cloudflare account.', 'OK', { duration: 8000 });
    void this.load();
  }

  protected async disconnect(): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: 'Disconnect Cloudflare?', message: 'appmarket.org revokes its access and deletes its tokens. Apps you already deployed keep running in your account.', confirm: 'Disconnect' },
        })
        .afterClosed(),
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.disconnect());
      await this.load();
      this.snackBar.open('Disconnected', undefined, { duration: 3000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    const connection = await firstValueFrom(this.api.connection());
    this.connection.set(connection);
    this.accounts.set(null);
    this.needsReconnect.set(false);
    if (connection.connected) {
      try {
        this.accounts.set(await firstValueFrom(this.api.accounts()));
      } catch {
        this.needsReconnect.set(true);
        this.accounts.set([]);
      }
    }
  }
}
