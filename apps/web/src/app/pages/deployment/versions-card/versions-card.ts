import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { WorkerVersion } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { DeploymentsApi } from '../../../api/deployments';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

const message = (error: unknown) => (error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined);

/** #38 (D8): the deployed Worker's versions in the buyer's account; roll back to any of them. */
@Component({
  selector: 'app-versions-card',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatListModule, MatProgressBarModule],
  templateUrl: './versions-card.html',
  styleUrl: './versions-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionsCard {
  readonly deploymentId = input.required<string>();
  private readonly api = inject(DeploymentsApi);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly versions = signal<WorkerVersion[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async rollback(v: WorkerVersion): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: `Roll back to version ${v.number}?`, message: 'All traffic moves to that version right away. You can roll forward again from this list.', confirm: 'Roll back' },
          width: '28rem',
        })
        .afterClosed(),
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.rollback(this.deploymentId(), v.id));
      this.snackBar.open(`Version ${v.number} is live`, undefined, { duration: 3000 });
      await this.load();
    } catch (error) {
      this.snackBar.open(message(error) ?? 'The rollback did not work.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.versions.set(await firstValueFrom(this.api.versions(this.deploymentId())));
      this.error.set(null);
    } catch (error) {
      this.error.set(message(error) ?? 'Could not load the versions from Cloudflare.');
    }
  }
}
