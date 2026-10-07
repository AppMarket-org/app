import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Developer } from '../../api/developer';
import { CowbellButton } from '../cowbell-button/cowbell-button';
import { STATE_LABELS, VISIBILITY_LABELS } from '../../pages/state-labels';

@Component({
  selector: 'app-repository-header',
  imports: [RouterLink, MatButtonModule, MatChipsModule, MatIconModule, MatMenuModule, CowbellButton],
  templateUrl: './repository-header.html',
  styleUrl: './repository-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryHeader {
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  readonly metadata = input<Repo | null>();
  readonly remote = input<string | null>();
  readonly managed = input(true);
  private readonly fetched = signal<Repo | null>(null);
  private readonly fetchedRemote = signal<string | null>(null);
  protected readonly repo = computed(() => this.metadata() === undefined ? this.fetched() : this.metadata());
  protected readonly cloneUrl = computed(() => this.remote() === undefined ? this.fetchedRemote() : this.remote());
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);
  protected readonly states = STATE_LABELS;
  protected readonly visibility = VISIBILITY_LABELS;
  private readonly api = inject(Developer);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  constructor() {
    effect((cleanup) => {
      const path = this.path();
      let current = true;
      cleanup(() => { current = false; });
      if (this.metadata() === undefined) {
        this.fetched.set(null);
        void firstValueFrom(this.api.repo(path)).then((repo) => { if (current) this.fetched.set(repo); }).catch(() => {});
      }
      if (this.managed() && this.remote() === undefined) {
        this.fetchedRemote.set(null);
        void firstValueFrom(this.api.git(path)).then((git) => { if (current) this.fetchedRemote.set(git.remote); }).catch(() => {});
      }
    });
  }

  protected copy(): void {
    const url = this.cloneUrl();
    if (url) this.snackBar.open(this.clipboard.copy(url) ? 'Clone URL copied' : 'Could not copy the clone URL', undefined, { duration: 2500 });
  }
}
