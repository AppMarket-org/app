import { RepositoryNav } from '../../../components/repository-nav/repository-nav';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { PullRequest, PullState } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../../auth/auth';
import { PullsApi } from '../../../api/pulls';
import { Seo } from '../../../seo/seo';

/** #259: a repo's pull requests. */
@Component({
  selector: 'app-pull-list',
  imports: [RepositoryNav, DatePipe, MatButtonModule, MatButtonToggleModule, MatChipsModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './pull-list.html',
  styleUrl: './pull-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PullListPage implements OnInit {
  private readonly api = inject(PullsApi);
  protected readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly managed = computed(() => this.auth.owner()?.handle === this.owner() || this.auth.orgs().some((membership) => membership.org.handle === this.owner()));
  protected readonly state = signal<PullState | 'all'>('open');
  protected readonly items = signal<PullRequest[] | null | undefined>(undefined);
  protected readonly counts = signal<Partial<Record<PullState, number>>>({});

  constructor() {
    inject(Seo).set({ title: 'Pull requests', description: 'Proposed changes to this repo.', path: '/', noindex: true });
    const seo = inject(Seo);
    effect(() => seo.setHeading([{label: this.owner(), link: '/' + this.owner()}, {label: this.slug(), link: (this.managed() ? '/dashboard/repos/' : '/') + this.path}]));
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async show(state: PullState | 'all'): Promise<void> {
    this.state.set(state);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.list(this.path, this.state()));
      this.items.set(r.items);
      this.counts.set(r.counts);
    } catch {
      this.items.set(null);
    }
  }
}
