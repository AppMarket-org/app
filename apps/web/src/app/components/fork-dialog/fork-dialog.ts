import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import type { Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../auth/auth';

export interface ForkDialogData {
  repo: Repo;
}

/** #26: "Use this template": copy a published app into a repo of your own (or an organization's). */
@Component({
  selector: 'app-fork-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule],
  templateUrl: './fork-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForkDialog {
  protected readonly data = inject<ForkDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ForkDialog, Repo>>(MatDialogRef);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly owners = computed(() => [this.auth.owner()?.handle, ...this.auth.orgs().map((m) => m.org.handle)].filter((h): h is string => !!h));
  protected readonly form = inject(FormBuilder).nonNullable.group({
    owner: [this.auth.owner()?.handle ?? '', Validators.required],
    name: [this.data.repo.name, [Validators.required, Validators.maxLength(80)]],
    // #198: start with the app's memory (its public notes; all of them for your own repos).
    copyMemory: [true],
  });

  protected async fork(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const repo = await firstValueFrom(this.http.post<Repo>(`/api/repos/${this.data.repo.fullName}/fork`, this.form.getRawValue()));
      this.ref.close(repo);
    } catch (e) {
      const code = e instanceof HttpErrorResponse ? (e.error as { error?: string } | null)?.error : undefined;
      this.error.set(
        code === 'quota_exceeded' ? 'You have reached the number of repos you can have.' : code === 'rate_limited' ? 'Too many new repos right now; try again in a minute.' : code === 'paid' ? 'Paid apps can be forked after purchase.' : 'Could not create the fork. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
