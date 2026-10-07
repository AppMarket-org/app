import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Repo, RepoVisibility } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Developer } from '../../../api/developer';

/** #366: who can read the repo, separate from publishing it on the marketplace. */
@Component({
  selector: 'app-visibility-card',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatRadioModule],
  templateUrl: './visibility-card.html',
  styleUrl: './visibility-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibilityCard {
  readonly repo = input.required<Repo>();
  readonly changed = output<Repo>();
  private readonly api = inject(Developer);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly choice = signal<RepoVisibility>('private');
  protected readonly busy = signal(false);
  /** A published app is public; it is unpublished first. */
  protected readonly published = computed(() => this.repo().state === 'published');
  protected readonly dirty = computed(() => this.choice() !== this.repo().visibility);

  constructor() {
    effect(() => this.choice.set(this.repo().visibility));
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      const repo = await firstValueFrom(this.api.setVisibility(this.repo().fullName, this.choice()));
      this.changed.emit(repo);
      this.snackBar.open(repo.visibility === 'public' ? 'The repo is public' : 'The repo is private', undefined, { duration: 3000 });
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
      this.snackBar.open(message ?? 'Could not change the visibility.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }
}
