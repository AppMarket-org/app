import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { CATEGORIES, type Listing } from '@appmarket/shared';
import { RuntimeBadge } from '../runtime-badge/runtime-badge';

@Component({
  selector: 'app-listing-card',
  imports: [MatButtonModule, MatCardModule, RouterLink, RuntimeBadge],
  templateUrl: './listing-card.html',
  styleUrl: './listing-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListingCard {
  readonly listing = input.required<Listing>();
  protected readonly categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}
