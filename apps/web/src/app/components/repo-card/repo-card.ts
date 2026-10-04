import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CATEGORIES, languageShares, type Repo } from '@appmarket/shared';
import { RuntimeBadge } from '../runtime-badge/runtime-badge';

import { Avatar } from '../avatar/avatar';


@Component({
  selector: 'app-repo-card',
  imports: [Avatar, MatButtonModule, MatCardModule, MatIconModule, RouterLink, RuntimeBadge],
  templateUrl: './repo-card.html',
  styleUrl: './repo-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoCard {
  /** #170: the main language of the published version. */
  protected readonly topLanguage = computed(() => languageShares(this.repo().languages)[0] ?? null);
  readonly repo = input.required<Repo>();
  protected readonly categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}
