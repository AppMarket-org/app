import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import type { DeploymentStatus, RuntimeLogEvent } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { DeploymentsApi } from '../../../api/deployments';

/** #40 (D10): the deploy's build and deploy output, and the live Worker's runtime logs. */
@Component({
  selector: 'app-logs-card',
  imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatCardModule, MatIconModule, MatListModule, MatProgressBarModule, MatTabsModule],
  templateUrl: './logs-card.html',
  styleUrl: './logs-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsCard {
  readonly deploymentId = input.required<string>();
  /** Re-read the deploy log whenever the status changes. */
  readonly status = input.required<DeploymentStatus>();
  private readonly api = inject(DeploymentsApi);
  protected readonly deployLog = signal<string | null | undefined>(undefined);
  protected readonly runtime = signal<RuntimeLogEvent[] | null>(null);
  protected readonly runtimeError = signal<string | null>(null);
  protected readonly loadingRuntime = signal(false);
  protected readonly minutes = signal(60);

  constructor() {
    effect(() => {
      this.status();
      void firstValueFrom(this.api.logs(this.deploymentId()))
        .then((l) => this.deployLog.set(l))
        .catch(() => this.deployLog.set(null));
    });
  }

  protected async loadRuntime(minutes = this.minutes()): Promise<void> {
    this.minutes.set(minutes);
    this.loadingRuntime.set(true);
    try {
      this.runtime.set(await firstValueFrom(this.api.runtimeLogs(this.deploymentId(), minutes)));
      this.runtimeError.set(null);
    } catch (error) {
      this.runtimeError.set((error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined) ?? 'Could not load runtime logs from Cloudflare.');
    } finally {
      this.loadingRuntime.set(false);
    }
  }

  protected tabChanged(index: number): void {
    if (index === 1 && this.runtime() === null) void this.loadRuntime();
  }
}
