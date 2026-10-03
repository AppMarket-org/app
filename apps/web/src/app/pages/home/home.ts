import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { CATEGORIES, type RepoPage } from '@appmarket/shared';
import { RepoCard } from '../../components/repo-card/repo-card';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatChipsModule, RouterLink, RepoCard],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  /** From latestResolver. */
  readonly latest = input.required<RepoPage>();
  protected readonly categories = CATEGORIES;

  constructor() {
    inject(Seo).set({
      title: 'App marketplace',
      description: 'Discover, try and deploy apps into your own Cloudflare account.',
      path: '/',
      heading: [],
      jsonLd: { '@type': 'WebSite', name: 'appmarket.org', url: 'https://appmarket.org/', potentialAction: { '@type': 'SearchAction', target: 'https://appmarket.org/search?q={q}', 'query-input': 'required name=q' } },
    });
  }
}
