import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CATEGORIES, type ListingPage } from '@appmarket/shared';
import { ListingResults } from '../../components/listing-results/listing-results';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-category',
  imports: [MatButtonModule, RouterLink, ListingResults],
  templateUrl: './category.html',
  styleUrl: './category.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Category {
  /** From categoryResolver. */
  readonly results = input.required<ListingPage>();
  protected readonly category = CATEGORIES.find((c) => c.slug === inject(ActivatedRoute).snapshot.paramMap.get('slug'));

  constructor() {
    const slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';
    inject(Seo).set(
      this.category
        ? { title: `${this.category.name} apps`, description: `${this.category.name} apps you can deploy to your own Cloudflare account.`, path: `/category/${slug}` }
        : { title: 'Category not found', description: 'This category does not exist.', path: `/category/${slug}`, noindex: true },
    );
  }
}
