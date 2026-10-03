import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { HANDLE_PATTERN, RESERVED_HANDLES } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../../api/owners';
import { Auth } from '../../../auth/auth';
import { Seo } from '../../../seo/seo';

/** #102: create an organization; you become its first owner. */
@Component({
  selector: 'app-new-org',
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  templateUrl: './new-org.html',
  styleUrl: './new-org.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewOrg {
  private readonly api = inject(OwnersApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    handle: ['', [Validators.required, Validators.pattern(HANDLE_PATTERN), (c: { value: unknown }) => (RESERVED_HANDLES.has(String(c.value)) ? { reserved: true } : null)]],
  });

  constructor() {
    inject(Seo).set({ title: 'New organization', description: 'Create an organization.', path: '/settings/orgs/new', noindex: true });
    // Suggest a handle from the name until the user edits the handle.
    this.form.controls.name.valueChanges.subscribe((name) => {
      if (!this.form.controls.handle.dirty) {
        this.form.controls.handle.setValue(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39));
      }
    });
  }

  protected async create(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const org = await firstValueFrom(this.api.createOrg(this.form.getRawValue()));
      this.auth.refreshOwner();
      await this.router.navigate(['/settings/orgs', org.handle]);
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 409 ? 'That name is taken.' : 'Could not create the organization. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
