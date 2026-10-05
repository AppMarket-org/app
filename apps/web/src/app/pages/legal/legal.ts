import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Markdown } from '../../components/markdown/markdown';
import { Seo } from '../../seo/seo';
import { CONTENT_POLICY } from './content/content-policy';
import { DEVELOPER_AGREEMENT } from './content/developer-agreement';
import { PRIVACY } from './content/privacy';
import { TERMS } from './content/terms';

const PAGES: Record<string, { title: string; description: string; markdown: string }> = {
  terms: {
    title: 'Terms of service',
    description: 'The terms for using appmarket.org.',
    markdown: TERMS,
  },
  'developer-agreement': {
    title: 'Developer agreement',
    description: 'The agreement for publishing apps on appmarket.org.',
    markdown: DEVELOPER_AGREEMENT,
  },
  'content-policy': {
    title: 'Content policy',
    description: 'What apps and content are allowed on appmarket.org.',
    markdown: CONTENT_POLICY,
  },
  privacy: {
    title: 'Privacy policy',
    description: 'What appmarket.org collects and why.',
    markdown: PRIVACY,
  },
};

/**
 * Legal drafts describe the implemented platform. Operator, contacts, governing law, retention,
 * and liability details remain placeholders until confirmed and reviewed before taking effect.
 */
@Component({
  selector: 'app-legal',
  imports: [MatButtonModule, MatCardModule, MatIconModule, Markdown, RouterLink],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Legal {
  protected readonly navigation = [
    { slug: 'terms', label: 'Terms of Service' },
    { slug: 'privacy', label: 'Privacy Policy' },
    { slug: 'content-policy', label: 'Content Policy' },
    { slug: 'developer-agreement', label: 'Developer Agreement' },
  ];
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(Seo);
  protected readonly slug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('page') ?? '')),
    {
      initialValue: this.route.snapshot.paramMap.get('page') ?? '',
    },
  );
  protected readonly page = computed(() => PAGES[this.slug()] ?? null);

  constructor() {
    effect(() => {
      const page = this.page();
      const slug = this.slug();
      this.seo.set(
        page
          ? { title: page.title, description: page.description, path: `/legal/${slug}` }
          : {
              title: 'Page not found',
              description: 'This page does not exist.',
              path: `/legal/${slug}`,
              noindex: true,
            },
      );
    });
  }
}
