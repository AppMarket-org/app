import { HttpClient } from '@angular/common/http';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { appUrl, runningApps } from '@appmarket/shared';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { CowbellsApi } from '../../api/cowbells';
import { DeploymentsApi } from '../../api/deployments';
import { Developer } from '../../api/developer';
import { RepoCard } from '../../components/repo-card/repo-card';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';
import { STATE_LABELS, VISIBILITY_LABELS } from '../state-labels';
import { DashboardCounts } from './dashboard';

function setPage(title: string, path: string, description: string): void {
  inject(Seo).set({ title, path, description, heading: [{ label: 'Dashboard' }], noindex: true });
}

@Component({
  selector: 'app-dashboard-repositories',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink, RuntimeBadge],
  templateUrl: './repositories.html',
  styleUrl: './dashboard-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRepositories {
  protected readonly states = STATE_LABELS;
  protected readonly visibility = VISIBILITY_LABELS;
  protected readonly repos = toSignal(inject(Developer).mine().pipe(catchError(() => of(null))));
  protected readonly impacts = toSignal(inject(HttpClient)
    .get<{ items: { id: string; kind: string; target: string; affected: string | null; title: string; guidance: string; repos: { repo: string; detail: string | null }[] }[] }>('/api/me/impacts')
    .pipe(map((r) => r.items), catchError(() => of([]))));

  constructor() {
    const counts = inject(DashboardCounts);
    effect(() => counts.repositories.set(this.repos()?.length));
    setPage('Your repositories', '/dashboard', 'Your Git repositories and agent work.');
  }
}

@Component({
  selector: 'app-dashboard-running-apps',
  imports: [DatePipe, LowerCasePipe, MatButtonModule, MatCardModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './running-apps.html',
  styleUrl: './dashboard-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRunningApps {
  protected readonly deployments = toSignal(inject(DeploymentsApi).mine().pipe(catchError(() => of(null))));
  protected readonly purchases = toSignal(inject(HttpClient)
    .get<{ items: { repo: string; name: string; amountCents: number; status: string; purchasedAt: string }[] }>('/api/me/purchases')
    .pipe(map((r) => r.items), catchError(() => of([]))));
  protected readonly deployStatus: Record<string, string> = { queued: 'Queued', building: 'Building', deploying: 'Deploying', succeeded: 'Live', failed: 'Failed' };
  /** #307: one entry per app (Worker and account), not per deployment. */
  protected readonly apps = computed(() => runningApps(this.deployments() ?? []));
  /** Where a live app answers: its custom domain, else workers.dev. */
  protected readonly address = (d: Parameters<typeof appUrl>[0]) => appUrl(d)?.replace(/^https?:\/\//, '') ?? null;

  constructor() {
    const counts = inject(DashboardCounts);
    effect(() => counts.apps.set(this.deployments() ? this.apps().length : undefined));
    setPage('Running apps', '/dashboard/apps', 'Your Cloudflare deployments and purchased apps.');
  }
}

@Component({
  selector: 'app-dashboard-cowbells',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, RepoCard, RouterLink],
  templateUrl: './cowbells.html',
  styleUrl: './dashboard-pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardCowbells {
  protected readonly cowbelled = toSignal(inject(CowbellsApi).mine().pipe(catchError(() => of(null))));

  constructor() {
    const counts = inject(DashboardCounts);
    effect(() => counts.cowbells.set(this.cowbelled()?.length));
    setPage('Your cowbells', '/dashboard/cowbells', 'The apps you saved with a cowbell.');
  }
}
