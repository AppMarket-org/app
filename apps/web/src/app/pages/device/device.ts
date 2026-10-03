import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../auth/auth';
import { Seo } from '../../seo/seo';

/** What each scope lets a device do, in words (#107). */
const SCOPE_TEXT: Record<string, string> = {
  'checkpoints:write': 'upload checkpoints (prompts and agent activity) for your commits',
  'checkpoints:read': 'read your checkpoints',
  'repos:read': 'see your repos',
};

/** Names people recognize for the device-login clients the API accepts (#104). */
const CLIENT_NAMES: Record<string, string> = { 'appmarket-cli': 'appmarket CLI' };

type Step = 'enter' | 'confirm' | 'approved' | 'denied';

/**
 * #104: approve a CLI or agent sign-in. The client shows a code and this page's address; the
 * signed-in user checks the code matches, sees which client is asking, and approves or denies.
 */
@Component({
  selector: 'app-device',
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, ReactiveFormsModule, RouterLink],
  templateUrl: './device.html',
  styleUrl: './device.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicePage {
  /** Prefilled from verification_uri_complete (?user_code=…). */
  readonly user_code = input<string>();

  protected readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);

  protected readonly step = signal<Step>('enter');
  protected readonly client = signal<string>('');
  protected readonly scopes = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly code = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8), Validators.maxLength(9)] });

  constructor() {
    inject(Seo).set({ title: 'Connect a device', description: 'Approve a CLI or agent sign-in.', path: '/device', noindex: true });
  }

  ngOnInit(): void {
    const prefilled = this.user_code();
    if (prefilled) {
      this.code.setValue(prefilled);
      void this.check();
    }
  }

  /** Codes are shown as XXXX-XXXX; the API wants the bare 8 characters. */
  protected normalized(): string {
    return this.code.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  protected async check(): Promise<void> {
    if (this.normalized().length !== 8 || this.busy()) return;
    await this.run(async () => {
      const status = await firstValueFrom(this.http.get<{ status: string; client_id?: string; scope?: string | null }>('/api/auth/device', { params: { user_code: this.normalized() } }));
      if (status.status !== 'pending') throw new Error('used');
      this.client.set(CLIENT_NAMES[status.client_id ?? ''] ?? status.client_id ?? 'An app');
      // No scope requested means the client's default set (the API grants the same).
      const asked = (status.scope ?? '').split(/\s+/).filter(Boolean);
      this.scopes.set((asked.length ? asked : Object.keys(SCOPE_TEXT)).map((s) => SCOPE_TEXT[s] ?? s));
      this.step.set('confirm');
    });
  }

  protected async decide(approve: boolean): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post(`/api/auth/device/${approve ? 'approve' : 'deny'}`, { userCode: this.normalized() }));
      this.step.set(approve ? 'approved' : 'denied');
    });
  }

  protected reset(): void {
    this.code.reset('');
    this.step.set('enter');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      const expired = e instanceof HttpErrorResponse && (e.status === 400 || e.status === 404);
      this.error.set(expired || (e instanceof Error && e.message === 'used') ? 'That code is not valid any more. Start the sign-in again on your device.' : 'Something went wrong. Try again.');
      this.step.set('enter');
    } finally {
      this.busy.set(false);
    }
  }
}
