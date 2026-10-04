import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ANDROID_PACKAGE, type Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';

/**
 * #33 (M2): APK downloads open after the developer declares the app's package name and that they
 * completed Android developer verification for it (enforced on certified devices in Brazil,
 * Indonesia, Singapore and Thailand since 30 September 2026, worldwide in 2027).
 */
@Component({
  selector: 'app-android-card',
  imports: [DatePipe, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  templateUrl: './android-card.html',
  styleUrl: './android-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AndroidCard {
  readonly repo = input.required<Repo>();
  readonly changed = output<Repo>();
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly pkg = signal('');
  protected readonly verified = signal(false);
  protected readonly busy = signal(false);
  protected readonly valid = computed(() => ANDROID_PACKAGE.test(this.pkg().trim()) && this.verified());

  protected async save(pkg: string | null): Promise<void> {
    this.busy.set(true);
    try {
      const repo = await firstValueFrom(this.http.put<Repo>(`/api/repos/${this.repo().fullName}/android`, pkg === null ? { package: null } : { package: pkg.trim(), verified: true }));
      this.changed.emit(repo);
      this.snackBar.open(pkg === null ? 'APK downloads closed' : 'APK downloads are open', undefined, { duration: 3000 });
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { issues?: { message: string }[] } | null)?.issues?.[0]?.message : undefined;
      this.snackBar.open(message ?? 'Could not save.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }
}
