import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute } from '@angular/router';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-category',
  imports: [MatCardModule],
  templateUrl: './category.html',
  styleUrl: './category.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Category {
  protected readonly slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';

  constructor() {
    inject(Seo).set({ title: `${this.slug} apps`, description: `Browse ${this.slug} apps on appmarket.org.`, path: `/category/${this.slug}` });
  }
}
