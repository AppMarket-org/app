import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Deployment, DeploymentStatus } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ConfigCard } from './config-card/config-card';
import { DomainsCard } from './domains-card/domains-card';
import { EjectCard } from './eject-card/eject-card';
import { LogsCard } from './logs-card/logs-card';
import { VersionsCard } from './versions-card/versions-card';
import { DeploymentsApi } from '../../api/deployments';
import { Seo } from '../../seo/seo';

const STEPS: { status: DeploymentStatus; label: string }[] = [
  { status: 'queued', label: 'Queued' },
  { status: 'building', label: 'Installing and building' },
  { status: 'deploying', label: 'Deploying to your account' },
  { status: 'succeeded', label: 'Live' },
];
const ORDER: DeploymentStatus[] = ['queued', 'building', 'deploying', 'succeeded'];
const POLL_MS = 3000;

/** PRD D6: progress and result of one deploy; polls until it finishes. */
@Component({
  selector: 'app-deployment',
  imports: [ConfigCard, DomainsCard, EjectCard, LogsCard, VersionsCard, DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './deployment.html',
  styleUrl: './deployment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeploymentPage {
  private readonly api = inject(DeploymentsApi);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly retrying = signal(false);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** undefined while loading; null when not found. */
  protected readonly deployment = signal<Deployment | null | undefined>(undefined);
  protected readonly steps = STEPS;
  protected readonly running = computed(() => {
    const s = this.deployment()?.status;
    return s === 'queued' || s === 'building' || s === 'deploying';
  });
  /** Failed deploys do not record which step failed; the error text says. */
  protected readonly stepState = (step: DeploymentStatus): 'done' | 'current' | 'todo' => {
    const d = this.deployment();
    if (!d || d.status === 'failed') return 'todo';
    if (d.status === 'succeeded') return 'done';
    const at = ORDER.indexOf(d.status);
    const index = ORDER.indexOf(step);
    return index < at ? 'done' : index === at ? 'current' : 'todo';
  };

  constructor() {
    inject(Seo).set({ title: 'Deployment', description: 'Deploy progress.', path: `/dashboard/deployments/${this.id}`, noindex: true });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  ngOnInit(): void {
    if (this.isBrowser) void this.poll();
  }

  /** Automatic deploys are retried in place: same branch, commit and Worker. */
  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      const { id } = await firstValueFrom(this.api.retry(this.id));
      clearTimeout(this.timer);
      this.id = id;
      this.deployment.set(undefined);
      await this.router.navigate(['/dashboard/deployments', id]);
      await this.poll();
    } catch (e) {
      const message = e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'Could not start the deploy again.';
      this.snackBar.open(message, undefined, { duration: 5000 });
    } finally {
      this.retrying.set(false);
    }
  }

  private async poll(): Promise<void> {
    try {
      this.deployment.set(await firstValueFrom(this.api.get(this.id)));
    } catch {
      if (this.deployment() === undefined) this.deployment.set(null);
    }
    if (this.running()) this.timer = setTimeout(() => void this.poll(), POLL_MS);
  }
}
