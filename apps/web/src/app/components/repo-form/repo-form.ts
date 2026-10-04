import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, FormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CATEGORIES, RUNTIMES, TARGET_PLATFORMS, type Repo, type RepoInput, type Runtime } from '@appmarket/shared';

const PLATFORM_LABELS: Record<(typeof TARGET_PLATFORMS)[number], string> = {
  workers: 'Cloudflare Workers',
  pwa: 'Installable web app',
  android: 'Android',
  ios: 'iOS',
  download: 'Download',
};

const SPDX = /^[A-Za-z0-9.+-]+( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$/;

/** License is optional; like the API, surrounding spaces are ignored. */
function licenseValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || SPDX.test(value) ? null : { pattern: true };
}

/** Repo details form, shared by create and edit (PRD R1, R24, R26). Validation mirrors the API. */
@Component({
  selector: 'app-repo-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './repo-form.html',
  styleUrl: './repo-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoForm {
  /** Existing repo to edit; omit to create. */
  readonly initial = input<Repo | null>(null);
  readonly submitLabel = input('Save');
  readonly saving = input(false);
  /** Messages from the API keyed by field name; shown on those fields. */
  readonly fieldErrors = input<Record<string, string>>({});
  readonly errorMessage = input<string | null>(null);
  readonly saved = output<RepoInput>();
  readonly cancelled = output<void>();

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
    license: ['', [Validators.maxLength(64), licenseValidator]],
    demoUrl: ['', [Validators.maxLength(300), Validators.pattern(/^\s*(https:\/\/\S+)?\s*$/)]],
  });

  private readonly runtimeValue = toSignal(this.form.controls.runtime.valueChanges, { initialValue: this.form.controls.runtime.value });
  protected readonly runtimeNote = computed(() => RUNTIMES[this.runtimeValue()].note);

  constructor() {
    effect(() => {
      const l = this.initial();
      if (l) {
        this.form.reset({ name: l.name, summary: l.summary, description: l.description, category: l.category, runtime: l.runtime, platforms: [...l.platforms], license: l.license ?? '', demoUrl: l.demoUrl ?? '' });
      }
    });
    effect(() => {
      for (const [field, message] of Object.entries(this.fieldErrors())) {
        const control = this.form.get(field);
        control?.setErrors({ ...control.errors, server: message });
        control?.markAsTouched();
      }
    });
  }

  protected togglePlatform(key: string, checked: boolean): void {
    const current = new Set(this.form.controls.platforms.value);
    if (checked) current.add(key);
    else current.delete(key);
    this.form.controls.platforms.setValue([...current]);
    this.form.controls.platforms.markAsTouched();
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    const v = this.form.getRawValue();
    this.saved.emit({
      ...v,
      category: v.category as RepoInput['category'],
      platforms: v.platforms as RepoInput['platforms'],
      license: v.license.trim() || null,
      demoUrl: v.demoUrl.trim() || null,
      name: v.name.trim(),
      summary: v.summary.trim(),
    });
  }
}
