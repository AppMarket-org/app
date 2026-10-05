import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CATEGORIES, type RepoPage } from '@appmarket/shared';
import { RepoCard } from '../../components/repo-card/repo-card';
import { HomeHero } from './home-hero/home-hero';
import { WorkspacePreview } from './workspace-preview/workspace-preview';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-home',
  host: { class: 'marketing-page' },
  imports: [HomeHero, MatButtonModule, MatChipsModule, MatIconModule, RouterLink, RepoCard, WorkspacePreview],
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
      title: 'A Git platform for agents and humans',
      description:
        'A Git platform for agents and humans. Host repositories, build apps together, capture agent checkpoints, and deploy into your own Cloudflare account.',
      path: '/',
      heading: [],
      jsonLd: {
        '@type': 'WebSite',
        name: 'appmarket.org',
        url: 'https://appmarket.org/',
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://appmarket.org/search?q={q}',
          'query-input': 'required name=q',
        },
      },
    });
  }
}
