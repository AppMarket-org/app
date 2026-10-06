import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { MemorySuggestion } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { MemoryApi } from '../../api/memory';

const KIND_LABELS: Record<MemorySuggestion['kind'], string> = { gotcha: 'Gotcha', command: 'Command', convention: 'Convention' };

/** #197: notes a checkpoint suggests; nothing goes into memory until someone accepts it. */
@Component({
  selector: 'app-memory-suggestions',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    @for (s of items(); track s.id) {
      <mat-card appearance="outlined" class="suggestion">
        <mat-card-content>
          <p class="kind"><mat-icon aria-hidden="true">lightbulb</mat-icon>{{ kinds[s.kind] }}@if (showCommit()) { · from checkpoint <code>{{ s.commit.slice(0, 7) }}</code> }</p>
          @if (editing() === s.id) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="text">
              <mat-label>Note</mat-label>
              <textarea matInput rows="2" maxlength="1000" [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>
            </mat-form-field>
          } @else {
            <p class="text-body">{{ s.text }}</p>
          }
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button type="button" (click)="decide(s, 'dismiss')" [disabled]="busy()">Dismiss</button>
          @if (editing() !== s.id) {
            <button mat-button type="button" (click)="editing.set(s.id); draft.set(s.text)">Edit</button>
          }
          <button mat-flat-button type="button" (click)="decide(s, 'accept')" [disabled]="busy()"><mat-icon>add</mat-icon>Add to memory</button>
        </mat-card-actions>
      </mat-card>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.5rem; }
    .kind { display: flex; align-items: center; gap: 0.375rem; margin: 0 0 0.25rem; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .kind mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    .text-body { margin: 0; white-space: pre-wrap; }
    .text { width: 100%; }
    .suggestion { border-style: dashed; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemorySuggestions {
  readonly path = input.required<string>();
  readonly items = input.required<MemorySuggestion[]>();
  readonly showCommit = input(true);
  /** After a suggestion was accepted or dismissed (the parent reloads). */
  readonly decided = output<void>();
  private readonly api = inject(MemoryApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly kinds = KIND_LABELS;
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal('');

  protected async decide(s: MemorySuggestion, decision: 'accept' | 'dismiss'): Promise<void> {
    this.busy.set(true);
    try {
      const edit = decision === 'accept' && this.editing() === s.id && this.draft().trim() !== s.text ? { text: this.draft().trim() } : undefined;
      await firstValueFrom(this.api.decide(this.path(), s.id, decision, edit));
      this.snackBar.open(decision === 'accept' ? 'Added to memory' : 'Dismissed', undefined, { duration: 2500 });
      this.editing.set(null);
      this.decided.emit();
    } catch (e) {
      this.snackBar.open(e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'That did not work. Try again.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }
}
