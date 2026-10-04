import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { inject } from '@angular/core';
import { PROFILE_LIMITS, type OwnerKind, type OwnerProfile, type OwnerProfileUpdate } from '@appmarket/shared';

const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/** #139: name, bio (or an organization's description), location and website. */
@Component({
  selector: 'app-profile-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './profile-form.html',
  styleUrl: './profile-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileForm {
  readonly kind = input.required<OwnerKind>();
  readonly name = input.required<string>();
  readonly profile = input.required<OwnerProfile>();
  readonly saving = input(false);
  /** Field errors from the API, by field name. */
  readonly errors = input<Record<string, string>>({});
  readonly save = output<OwnerProfileUpdate>();

  protected readonly limits = PROFILE_LIMITS;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.maxLength(PROFILE_LIMITS.name)]],
    bio: ['', [Validators.maxLength(PROFILE_LIMITS.bio)]],
    location: ['', [Validators.maxLength(PROFILE_LIMITS.location)]],
    website: ['', [Validators.maxLength(PROFILE_LIMITS.website), Validators.pattern(HTTPS)]],
  });

  constructor() {
    effect(() => {
      const p = this.profile();
      this.form.reset({ name: this.name(), bio: p.bio ?? '', location: p.location ?? '', website: p.website ?? '' });
      if (this.kind() === 'org') this.form.controls.name.addValidators(Validators.required);
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    // Empty clears a field (a user's name then falls back to their sign-in name).
    this.save.emit({ name: v.name.trim() || null, bio: v.bio.trim() || null, location: v.location.trim() || null, website: v.website.trim() || null });
  }
}
