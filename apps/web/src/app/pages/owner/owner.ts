import { NotFoundView } from '../../components/not-found-view/not-found-view';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RepoCard } from '../../components/repo-card/repo-card';
import { Avatar } from '../../components/avatar/avatar';
import { PinsDialog, type PinsDialogData } from '../../components/pins-dialog/pins-dialog';
import { ContributionGraph } from '../../components/contribution-graph/contribution-graph';
import { ActivityFeed } from '../../components/activity-feed/activity-feed';
import { OwnersApi } from '../../api/owners';
import { Auth } from '../../auth/auth';
import type { ContributionCalendar, Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';
import type { OwnerPageData } from './owner-resolver';

/** #102, #139: appmarket.org/<handle>: a user's or organization's profile and public repos. */
@Component({
  selector: 'app-owner',
  imports: [NotFoundView, ActivityFeed, Avatar, ContributionGraph, DatePipe, MatButtonModule, MatChipsModule, MatIconModule, MatListModule, MatTooltipModule, RepoCard, RouterLink],
  templateUrl: './owner.html',
  styleUrl: './owner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnerPage {
  /** From ownerResolver; null when the handle does not exist. */
  readonly page = input<OwnerPageData>(null);

  private readonly auth = inject(Auth);
  private readonly dialog = inject(MatDialog);
  /** #142: shown pins; replaced after "Customize your pins". */
  protected readonly pinned = linkedSignal<Repo[]>(() => this.page()?.pinned ?? []);
  protected readonly pinnedFallback = linkedSignal(() => this.page()?.pinnedFallback ?? false);
  /** #144: the calendar shown; null year = the last 12 months. */
  protected readonly calendar = linkedSignal<ContributionCalendar | null>(() => this.page()?.contributions ?? null);
  protected readonly year = signal<number | null>(null);
  private readonly owners = inject(OwnersApi);

  protected async showYear(year: number | null): Promise<void> {
    const handle = this.page()?.owner.handle;
    if (!handle) return;
    this.year.set(year);
    this.calendar.set(await firstValueFrom(this.owners.contributions(handle, year)).catch(() => this.calendar()));
  }

  /** The user themself, or an owner of the organization. */
  protected readonly canEdit = computed(() => {
    const owner = this.page()?.owner;
    if (!owner) return false;
    if (owner.kind === 'user') return this.auth.owner()?.id === owner.id;
    return this.auth.orgs().some((m) => m.org.id === owner.id && m.role === 'owner');
  });

  protected async customizePins(): Promise<void> {
    const owner = this.page()!.owner;
    const data: PinsDialogData = owner.kind === 'org' ? { org: owner.handle } : {};
    const pinned = await firstValueFrom(this.dialog.open<PinsDialog, PinsDialogData, Repo[]>(PinsDialog, { data, width: '36rem', maxWidth: 'calc(100vw - 2rem)' }).afterClosed());
    if (!pinned) return;
    this.pinned.set(pinned.length ? pinned : this.page()!.repos.slice(0, 6));
    this.pinnedFallback.set(!pinned.length);
  }

  constructor() {
    const route = inject(ActivatedRoute);
    const seo = inject(Seo);
    effect(() => {
      const data = this.page();
      const handle = route.snapshot.paramMap.get('owner') ?? '';
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
    });
  }
}
