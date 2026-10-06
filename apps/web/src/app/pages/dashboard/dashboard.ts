import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** The tabs' counts: loaded together when the dashboard opens, then kept current by each tab's page. */
@Injectable()
export class DashboardCounts {
  readonly repositories = signal<number | undefined>(undefined);
  readonly apps = signal<number | undefined>(undefined);
  readonly cowbells = signal<number | undefined>(undefined);
}

@Component({
  selector: 'app-dashboard',
  imports: [MatIconModule, MatTabsModule, RouterLink, RouterLinkActive, RouterOutlet],
  providers: [DashboardCounts],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly counts = inject(DashboardCounts);

  constructor() {
    inject(HttpClient)
      .get<{ repositories: number; apps: number; cowbells: number }>('/api/me/counts')
      .subscribe({
        next: (n) => {
          // A page that already loaded its list knows best; fill in the rest.
          if (this.counts.repositories() === undefined) this.counts.repositories.set(n.repositories);
          if (this.counts.apps() === undefined) this.counts.apps.set(n.apps);
          if (this.counts.cowbells() === undefined) this.counts.cowbells.set(n.cowbells);
        },
        error: () => undefined,
      });
  }
}
