import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { catchError, of } from 'rxjs';
import { Developer } from '../../api/developer';

/** Picks one of your repos (the + menu's New issue outside a repo). Closes with "owner/slug". */
@Component({
  selector: 'app-repo-picker',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="filter">
        <mat-icon matPrefix aria-hidden="true">search</mat-icon>
        <input matInput placeholder="Find a repository" aria-label="Find a repository" [value]="query()" (input)="query.set($any($event.target).value)" cdkFocusInitial />
      </mat-form-field>
      @if (repos() === undefined) {
        <mat-progress-bar mode="indeterminate" aria-label="Loading your repositories" />
      } @else {
        <mat-action-list aria-label="Your repositories">
          @for (r of shown(); track r.fullName) {
            <button mat-list-item type="button" (click)="ref.close(r.fullName)">
              <mat-icon matListItemIcon aria-hidden="true">folder_open</mat-icon>
              <span matListItemTitle>{{ r.name }}</span>
              <span matListItemLine>{{ r.fullName }}</span>
            </button>
          } @empty {
            <p class="empty">{{ repos()?.length ? 'No repository matches.' : 'You have no repositories yet.' }}</p>
          }
        </mat-action-list>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button type="button" mat-dialog-close>Cancel</button></mat-dialog-actions>
  `,
  styles: `
    .filter { width: 100%; margin-bottom: 0.5rem; }
    .empty { color: var(--mat-sys-on-surface-variant); padding: 0.5rem 1rem; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoPicker {
  protected readonly data = inject<{ title: string }>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<RepoPicker, string>);
  protected readonly query = signal('');
  protected readonly repos = toSignal(inject(Developer).mine().pipe(catchError(() => of([]))));
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return (this.repos() ?? []).filter((r) => r.state !== 'removed' && (!q || r.fullName.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))).slice(0, 50);
  });
}
