import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { ActivityMonth, ContributionKind } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../api/owners';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Created 23 commits in 3 repos" and friends. */
export function describeGroup(kind: ContributionKind, total: number, repos: number): string {
  switch (kind) {
    case 'commit':
      return `Created ${plural(total, 'commit')} in ${plural(repos, 'repo')}`;
    case 'repo':
      return `Created ${plural(total, 'repo')}`;
    case 'version':
      return `Submitted ${plural(total, 'version')}${repos > 1 ? ` in ${plural(repos, 'repo')}` : ''}`;
    case 'release':
      return `Uploaded ${plural(total, 'release')}${repos > 1 ? ` in ${plural(repos, 'repo')}` : ''}`;
    case 'checkpoint':
      return `Recorded ${plural(total, 'checkpoint')}${repos > 1 ? ` in ${plural(repos, 'repo')}` : ''}`;
  }
}

const ICONS: Record<ContributionKind, string> = { commit: 'commit', repo: 'create_new_folder', version: 'sell', release: 'inventory_2', checkpoint: 'history_edu' };

/** #145: activity by month below the contribution graph (users) or on organization profiles. */
@Component({
  selector: 'app-activity-feed',
  imports: [MatButtonModule, MatExpansionModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './activity-feed.html',
  styleUrl: './activity-feed.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityFeed {
  readonly handle = input.required<string>();
  /** null: the last 12 months. */
  readonly year = input<number | null>(null);

  private readonly api = inject(OwnersApi);
  protected readonly months = signal<ActivityMonth[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly describe = describeGroup;
  protected readonly icons = ICONS;

  constructor() {
    // Reload from the newest month whenever the profile or the selected year changes.
    effect(() => {
      const handle = this.handle();
      const year = this.year();
      untracked(() => void this.load(handle, year, null, true));
    });
  }

  protected monthName(month: string): string {
    return new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  protected more(): Promise<void> {
    return this.load(this.handle(), this.year(), this.next(), false);
  }

  private async load(handle: string, year: number | null, before: string | null, reset: boolean): Promise<void> {
    this.loading.set(true);
    try {
      const page = await firstValueFrom(this.api.activity(handle, year, before));
      this.months.update((m) => (reset ? page.months : [...m, ...page.months]));
      this.next.set(page.next);
    } catch {
      if (reset) this.months.set([]);
      this.next.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
