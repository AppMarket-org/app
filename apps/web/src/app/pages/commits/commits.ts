import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import type { CommitEntry } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CheckpointsApi } from '../../api/checkpoints';
import { Auth } from '../../auth/auth';
import { CommitList } from '../../components/commit-list/commit-list';
import { RepositoryHeader } from '../../components/repository-header/repository-header';
import { RepositoryNav } from '../../components/repository-nav/repository-nav';
import { Seo } from '../../seo/seo';

/** A branch's commit history, each commit with the prompts behind it where the viewer may see them. */
@Component({
  selector: 'app-commits',
  imports: [CommitList, MatButtonModule, MatIconModule, MatProgressBarModule, RepositoryHeader, RepositoryNav],
  templateUrl: './commits.html',
  styleUrl: './commits.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitsPage {
  private readonly api = inject(CheckpointsApi);
  private readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  protected readonly requested = computed(() => this.query().get('ref'));
  protected readonly managed = computed(() => this.auth.owner()?.handle === this.owner() || this.auth.orgs().some((m) => m.org.handle === this.owner()));
  /** undefined while loading the first page; null when it failed. */
  protected readonly items = signal<CommitEntry[] | null | undefined>(undefined);
  protected readonly ref = signal('');
  protected readonly next = signal<number | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'Commits', description: 'The commit history and the prompts behind it.', path: '/', noindex: true });
    effect(() => seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: `/${this.path()}/code` }, { label: 'Commits' }]));
    effect(() => {
      const path = this.path();
      const ref = this.requested();
      untracked(() => void this.load(path, ref));
    });
  }

  private async load(path: string, ref: string | null): Promise<void> {
    this.items.set(undefined);
    try {
      const page = await firstValueFrom(this.api.commits(path, ref));
      this.items.set(page.items);
      this.ref.set(page.ref);
      this.next.set(page.next);
    } catch {
      this.items.set(null);
    }
  }

  protected async more(): Promise<void> {
    const offset = this.next();
    if (offset === null) return;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(this.api.commits(this.path(), this.ref(), offset));
      this.items.update((items) => [...(items ?? []), ...page.items]);
      this.next.set(page.next);
    } finally {
      this.loadingMore.set(false);
    }
  }
}
