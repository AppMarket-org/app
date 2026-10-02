import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { CATEGORIES, RUNTIMES, type ListingPage } from '@appmarket/shared';
import { ListingResults } from '../../components/listing-results/listing-results';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-search',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, ListingResults],
  templateUrl: './search.html',
  styleUrl: './search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  /** From searchResolver. */
  readonly results = input.required<ListingPage>();
  readonly q = input<string>();
  readonly category = input<string>();
  readonly runtime = input<string>();

  protected readonly categories = CATEGORIES;
  protected readonly runtimes = Object.entries(RUNTIMES).map(([key, value]) => ({ key, name: value.name }));
  protected readonly query = computed(() => ({ q: this.q() || undefined, category: this.category() || undefined, runtime: this.runtime() || undefined }));

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const filtered = ['q', 'category', 'runtime', 'page'].some((k) => params.has(k));
    inject(Seo).set({
      title: params.get('q') ? `Apps matching "${params.get('q')}"` : 'Search apps',
      description: 'Search source-available apps you can deploy to your own Cloudflare account.',
      path: '/search',
      // Only the unfiltered search page is indexed; filtered pages are duplicates.
      noindex: filtered,
    });
  }
}
