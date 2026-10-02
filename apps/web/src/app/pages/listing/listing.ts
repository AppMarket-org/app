import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { ActivatedRoute } from '@angular/router';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-listing',
  imports: [MatButtonModule, MatCardModule, MatChipsModule],
  templateUrl: './listing.html',
  styleUrl: './listing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Listing {
  protected readonly slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';

  constructor() {
    inject(Seo).set({ title: this.slug, description: `${this.slug} on appmarket.org`, path: `/apps/${this.slug}`, jsonLd: { '@type': 'SoftwareApplication', name: this.slug } });
  }
}
