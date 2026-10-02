import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { CATEGORIES, RUNTIMES, TARGET_PLATFORMS, type Listing, type ListingInput, type Runtime } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';

const PLATFORM_LABELS: Record<(typeof TARGET_PLATFORMS)[number], string> = {
  workers: 'Cloudflare Workers',
  pwa: 'Installable web app',
  android: 'Android',
  ios: 'iOS',
  download: 'Download',
};

/** PRD R15: create a draft listing. Its Artifacts repo is created with it (R2). */
@Component({
  selector: 'app-create-listing',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './create-listing.html',
  styleUrl: './create-listing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateListing {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly categories = CATEGORIES;
  protected readonly runtimes = Object.entries(RUNTIMES).map(([key, info]) => ({ key: key as Runtime, ...info }));
  protected readonly platforms = TARGET_PLATFORMS.map((key) => ({ key, label: PLATFORM_LABELS[key] }));

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(80)]],
    summary: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(160)]],
    description: ['', [Validators.maxLength(20_000)]],
    category: ['', [Validators.required]],
    runtime: ['workers-js' as Runtime, [Validators.required]],
    platforms: [['workers'] as string[], [Validators.required]],
    license: ['', [Validators.maxLength(64), Validators.pattern(/^[A-Za-z0-9.+-]+( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$/)]],
  });

  private readonly runtimeValue = toSignal(this.form.controls.runtime.valueChanges, { initialValue: this.form.controls.runtime.value });
  protected readonly runtimeNote = computed(() => RUNTIMES[this.runtimeValue()].note);
  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);

  constructor() {
    inject(Seo).set({ title: 'New listing', description: 'Create an app listing.', path: '/dashboard/new', noindex: true });
  }

  protected togglePlatform(key: string, checked: boolean): void {
    const current = new Set(this.form.controls.platforms.value);
    if (checked) current.add(key);
    else current.delete(key);
    this.form.controls.platforms.setValue([...current]);
    this.form.controls.platforms.markAsTouched();
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.serverError.set(null);
    const value = this.form.getRawValue();
    const body: ListingInput = { ...value, category: value.category as ListingInput['category'], platforms: value.platforms as ListingInput['platforms'], license: value.license.trim() || null };
    try {
      const listing = await firstValueFrom(this.http.post<Listing>('/api/listings', body));
      this.snackBar.open('Draft created. Push your code, then submit a version for review.', 'OK', { duration: 6000 });
      await this.router.navigate(['/apps', listing.slug]);
    } catch (error) {
      this.serverError.set(this.describe(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Maps API errors onto fields where possible, otherwise a message. */
  private describe(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'Something went wrong. Please try again.';
    const body = error.error as { error?: string; issues?: { path: string; message: string }[]; limit?: number } | null;
    if (error.status === 400 && body?.issues) {
      for (const issue of body.issues) {
        this.form.get(issue.path)?.setErrors({ server: issue.message });
      }
      return 'Please fix the highlighted fields.';
    }
    if (error.status === 409 && body?.error === 'quota_exceeded') return `You have reached the limit of ${body.limit} listings. Remove one first.`;
    if (error.status === 429) return 'Too many listings created in a short time. Wait a minute and try again.';
    if (error.status === 401) return 'Your session expired. Sign in again.';
    return 'Could not create the listing. Please try again.';
  }
}
