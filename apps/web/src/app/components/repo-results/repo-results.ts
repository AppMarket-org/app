import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { RepoPage } from '@appmarket/shared';
import { RepoCard } from '../repo-card/repo-card';

/** Result grid with previous/next links that keep the current query (crawlable, no JS needed). */
@Component({
  selector: 'app-repo-results',
  imports: [MatButtonModule, RouterLink, RepoCard],
  templateUrl: './repo-results.html',
  styleUrl: './repo-results.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoResults {
  readonly results = input.required<RepoPage>();
  /** Query params to keep when paging (for example q, category, runtime). */
  readonly query = input<Record<string, string | undefined>>({});

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.results().total / this.results().pageSize)));
  protected readonly pageParams = (page: number) => ({ ...this.query(), page: page > 1 ? page : undefined });
}
