import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { HANDLE_PATTERN, RESERVED_HANDLES, type OrgMembership, type Owner } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../api/owners';
import { Auth } from '../../auth/auth';
import { Seo } from '../../seo/seo';

/** #102: your username and your organizations. */
@Component({
  selector: 'app-settings',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSnackBarModule, ReactiveFormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  private readonly api = inject(OwnersApi);
  private readonly auth = inject(Auth);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly owner = signal<Owner | null>(null);
  protected readonly orgs = signal<OrgMembership[] | undefined>(undefined);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly handle = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(HANDLE_PATTERN), (c) => (RESERVED_HANDLES.has(String(c.value)) ? { reserved: true } : null)],
  });

  constructor() {
    inject(Seo).set({ title: 'Settings', description: 'Your username and organizations.', path: '/settings', noindex: true });
  }

  async ngOnInit(): Promise<void> {
    const { owner, orgs } = await firstValueFrom(this.api.me());
    this.owner.set(owner);
    this.orgs.set(orgs);
    this.handle.setValue(owner.handle);
  }

  protected async saveHandle(): Promise<void> {
    this.handle.markAsTouched();
    const value = this.handle.value.trim().toLowerCase();
    if (this.handle.invalid || this.saving() || value === this.owner()?.handle) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      this.owner.set(await firstValueFrom(this.api.setHandle(value)));
      this.auth.refreshOwner();
      this.snackBar.open(`Your username is now ${value}`, undefined, { duration: 4000 });
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 409 ? 'That name is taken.' : 'Could not change your username. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
