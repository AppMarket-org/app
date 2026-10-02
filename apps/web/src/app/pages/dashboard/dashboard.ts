import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Developer } from '../../api/developer';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';
import { STATE_LABELS } from '../state-labels';

/** PRD R16: the signed-in developer's listings. */
@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatProgressBarModule, RouterLink, RuntimeBadge],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly states = STATE_LABELS;
  /** undefined while loading; null on error. */
  protected readonly listings = toSignal(
    inject(Developer)
      .mine()
      .pipe(
        map((items) => items),
        catchError(() => of(null)),
      ),
  );

  constructor() {
    inject(Seo).set({ title: 'Developer dashboard', description: 'Manage your listings.', path: '/dashboard', noindex: true });
  }
}
