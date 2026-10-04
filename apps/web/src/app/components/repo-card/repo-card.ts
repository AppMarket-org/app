import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { CATEGORIES, type Repo } from '@appmarket/shared';
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
  readonly repo = input.required<Repo>();
  protected readonly categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}
