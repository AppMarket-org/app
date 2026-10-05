import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Counts are learned from visited pages, without fetching unrelated lists. */
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
}
