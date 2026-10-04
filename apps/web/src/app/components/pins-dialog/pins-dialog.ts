import { CdkDrag, CdkDragHandle, type CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MAX_PINS, type Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../api/owners';

export interface PinsDialogData {
  /** Organization handle when editing an organization's pins. */
  org?: string;
}

/** #142: pick up to six public repos and order them (drag, or move up/down from the keyboard). */
@Component({
  selector: 'app-pins-dialog',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, MatButtonModule, MatCheckboxModule, MatDialogModule, MatIconModule, MatListModule, MatProgressBarModule],
  templateUrl: './pins-dialog.html',
  styleUrl: './pins-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinsDialog {
  private readonly data = inject<PinsDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PinsDialog, Repo[]>>(MatDialogRef);
  private readonly api = inject(OwnersApi);

  protected readonly max = MAX_PINS;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly candidates = signal<Repo[]>([]);
  protected readonly selected = signal<Repo[]>([]);
  protected readonly full = computed(() => this.selected().length >= MAX_PINS);
  protected readonly status = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const { pinned, candidates } = await firstValueFrom(this.api.pins(this.data.org));
      this.candidates.set(candidates);
      this.selected.set(pinned);
    } catch {
      this.error.set('Could not load your repos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isSelected(repo: Repo): boolean {
    return this.selected().some((r) => r.id === repo.id);
  }

  protected toggle(repo: Repo, on: boolean): void {
    this.selected.update((list) => (on ? (list.length < MAX_PINS && !list.some((r) => r.id === repo.id) ? [...list, repo] : list) : list.filter((r) => r.id !== repo.id)));
  }

  protected drop(event: CdkDragDrop<Repo[]>): void {
    this.selected.update((list) => {
      const next = [...list];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  /** Moves by identity, so a click handled before the list re-renders still moves the right row. */
  protected move(repo: Repo, by: -1 | 1): void {
    const index = this.selected().findIndex((r) => r.id === repo.id);
    if (index < 0 || index + by < 0 || index + by >= this.selected().length) return;
    const next = [...this.selected()];
    moveItemInArray(next, index, index + by);
    this.selected.set(next);
    const at = next.findIndex((r) => r.id === repo.id);
    // Announced to screen readers (aria-live), since the moved row's buttons change position.
    this.status.set(`${repo.name} moved to position ${at + 1} of ${next.length}`);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const { pinned } = await firstValueFrom(this.api.savePins(this.selected().map((r) => r.fullName), this.data.org));
      this.ref.close(pinned);
    } catch {
      this.error.set('Could not save your pins. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
