import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CATEGORIES, RUNTIMES, type Listing as ListingData } from '@appmarket/shared';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-listing',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, RouterLink],
  templateUrl: './listing.html',
  styleUrl: './listing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Listing {
  /** From listingResolver; null when the listing does not exist or is not visible. */
  readonly listing = input<ListingData | null>(null);

  protected readonly runtimes = RUNTIMES;
  protected readonly categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;

  constructor() {
    const data = inject(ActivatedRoute).snapshot.data['listing'] as ListingData | null;
    const slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';
    const seo = inject(Seo);
    if (!data) {
      seo.set({ title: 'App not found', description: 'This app does not exist or is not published.', path: `/apps/${slug}`, noindex: true });
      return;
    }
    seo.set({
      title: data.name,
      description: data.summary,
      path: `/apps/${data.slug}`,
      noindex: data.state !== 'published',
      jsonLd: {
        '@type': 'SoftwareApplication',
        name: data.name,
        description: data.summary,
        applicationCategory: this.categoryName(data.category),
        operatingSystem: 'Web',
        softwareVersion: data.publishedTag ?? undefined,
        license: data.license ?? undefined,
        offers: { '@type': 'Offer', price: (data.priceCents / 100).toFixed(2), priceCurrency: 'USD' },
        author: { '@type': 'Person', name: data.owner.name },
      },
    });
  }
}
