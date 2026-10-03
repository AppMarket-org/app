import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { DeploymentsApi } from '../../api/deployments';
import { Developer } from '../../api/developer';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';
import { STATE_LABELS } from '../state-labels';

/** PRD R16/D6: the signed-in user's running apps (deploys) and repos (repos). */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink, RuntimeBadge],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly states = STATE_LABELS;
  /** undefined while loading; null on error. */
  protected readonly repos = toSignal(
    inject(Developer)
      .mine()
      .pipe(
        map((items) => items),
        catchError(() => of(null)),
      ),
  );

  /** D6: the user's deploys into Cloudflare; empty on error. */
  protected readonly deployments = toSignal(inject(DeploymentsApi).mine().pipe(catchError(() => of([]))));
  protected readonly deployStatus: Record<string, string> = { queued: 'Queued', building: 'Building', deploying: 'Deploying', succeeded: 'Live', failed: 'Failed' };

  constructor() {
    inject(Seo).set({ title: 'Dashboard', description: 'Your running apps and repos.', path: '/dashboard', noindex: true });
  }
}
