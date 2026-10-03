import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { HANDLE_PATTERN, RESERVED_HANDLES, type OrgMembership, type Owner, type SessionInfo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../api/owners';
import { Auth } from '../../auth/auth';
import { Seo } from '../../seo/seo';

/** #102: your username and your organizations. */
@Component({
  selector: 'app-settings',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSnackBarModule, ReactiveFormsModule, RouterLink],
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
  protected readonly sessions = signal<SessionInfo[] | undefined>(undefined);
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
    this.sessions.set(await firstValueFrom(this.api.sessions()).catch(() => []));
  }

  /** A short label from a user agent: browser and system, or the tool's name. */
  protected device(ua: string | null): string {
    if (!ua) return 'Unknown device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
    const system = /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : null;
    if (browser) return system ? `${browser} on ${system}` : browser;
    return ua.split(/[\s/]/)[0] || 'Unknown device';
  }

  protected async signOut(session: SessionInfo): Promise<void> {
    await firstValueFrom(this.api.revokeSession(session.id)).catch(() => undefined);
    this.sessions.update((all) => all?.filter((s) => s.id !== session.id));
    this.snackBar.open('Signed out that device', undefined, { duration: 3000 });
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
