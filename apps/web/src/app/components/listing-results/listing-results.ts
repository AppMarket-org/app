import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { ListingPage } from '@appmarket/shared';
import { ListingCard } from '../listing-card/listing-card';

/** Result grid with previous/next links that keep the current query (crawlable, no JS needed). */
@Component({
  selector: 'app-listing-results',
  imports: [MatButtonModule, RouterLink, ListingCard],
  templateUrl: './listing-results.html',
  styleUrl: './listing-results.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListingResults {
  readonly results = input.required<ListingPage>();
  /** Query params to keep when paging (for example q, category, runtime). */
  readonly query = input<Record<string, string | undefined>>({});

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.results().total / this.results().pageSize)));
  protected readonly pageParams = (page: number) => ({ ...this.query(), page: page > 1 ? page : undefined });
}
