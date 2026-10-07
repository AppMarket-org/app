import { NotFoundView } from '../../components/not-found-view/not-found-view';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CATEGORIES, type RepoPage } from '@appmarket/shared';
import { RepoResults } from '../../components/repo-results/repo-results';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-category',
  imports: [NotFoundView, RepoResults],
  templateUrl: './category.html',
  styleUrl: './category.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Category {
  /** From categoryResolver. */
  readonly results = input.required<RepoPage>();
  protected readonly category = CATEGORIES.find((c) => c.slug === inject(ActivatedRoute).snapshot.paramMap.get('slug'));

  constructor() {
    const slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';
    inject(Seo).set(
      this.category
        ? { title: `${this.category.name} apps`, description: `${this.category.name} apps you can deploy to your own Cloudflare account.`, path: `/category/${slug}`, image: `/api/og/category/${slug}.png?v=2` }
        : { title: 'Category not found', description: 'This category does not exist.', path: `/category/${slug}`, noindex: true },
    );
  }
}
