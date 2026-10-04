import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RepoCard } from '../../components/repo-card/repo-card';
import { Avatar } from '../../components/avatar/avatar';
import { Seo } from '../../seo/seo';
import type { OwnerPageData } from './owner-resolver';

/** #102, #139: appmarket.org/<handle>: a user's or organization's profile and public repos. */
@Component({
  selector: 'app-owner',
  imports: [Avatar, DatePipe, MatButtonModule, MatChipsModule, MatIconModule, MatListModule, MatTooltipModule, RepoCard, RouterLink],
  templateUrl: './owner.html',
  styleUrl: './owner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnerPage {
  /** From ownerResolver; null when the handle does not exist. */
  readonly page = input<OwnerPageData>(null);

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    const data = route.data['page'] as OwnerPageData;
    const handle = route.paramMap.get('owner') ?? '';
    const seo = inject(Seo);
    if (!data) {
      seo.set({ title: 'Not found', description: 'This user or organization does not exist.', path: `/${handle}`, noindex: true });
      return;
    }
    const { owner, profile, repos } = data;
    const site = 'https://appmarket.org';
    const url = `${site}/${owner.handle}`;
    const image = owner.avatarUrl ? (owner.avatarUrl.startsWith('/') ? site + owner.avatarUrl : owner.avatarUrl) : undefined;
    seo.set({
      title: `${owner.name} (${owner.handle})`,
      description: profile?.bio ?? `${repos.length} app${repos.length === 1 ? '' : 's'} by ${owner.name} on appmarket.org.`,
      path: `/${owner.handle}`,
      heading: [{ label: owner.handle }],
      image,
      // #141: schema.org ProfilePage with the person or organization as its main entity.
      jsonLd: {
        '@type': 'ProfilePage',
        url,
        ...(profile?.memberSince ? { dateCreated: profile.memberSince } : {}),
        mainEntity: {
          '@type': owner.kind === 'org' ? 'Organization' : 'Person',
          name: owner.name,
          alternateName: owner.handle,
          url,
          ...(image ? { image } : {}),
          ...(profile?.bio ? { description: profile.bio } : {}),
          ...(profile?.website ? { sameAs: [profile.website] } : {}),
          ...(owner.kind === 'user' && profile?.location ? { homeLocation: { '@type': 'Place', name: profile.location } } : {}),
          ...(owner.kind === 'org' && profile?.location ? { location: { '@type': 'Place', name: profile.location } } : {}),
        },
      },
    });
  }
}
