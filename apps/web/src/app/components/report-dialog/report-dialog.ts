import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { REPORT_REASONS, type ReportReason } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Turnstile } from '../../auth/turnstile/turnstile';

/** PRD R18: report a listing (abuse, DMCA, malware). Closes with true once sent. */
@Component({
  selector: 'app-report-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, Turnstile],
  templateUrl: './report-dialog.html',
  styleUrl: './report-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportDialog {
  protected readonly data = inject<{ slug: string; name: string }>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ReportDialog, boolean>>(MatDialogRef);
  private readonly http = inject(HttpClient);

  protected readonly reasons = Object.entries(REPORT_REASONS).map(([key, label]) => ({ key: key as ReportReason, label }));
  protected readonly captchaToken = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    reason: ['' as ReportReason | '', Validators.required],
    details: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(5000)]],
    contact: ['', [Validators.email, Validators.maxLength(200)]],
  });

  protected async send(): Promise<void> {
    this.form.markAllAsTouched();
    const token = this.captchaToken();
    if (this.form.invalid || !token || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await firstValueFrom(
        this.http.post(`/api/listings/${this.data.slug}/reports`, { reason: v.reason, details: v.details.trim(), contact: v.contact.trim() || null }, { headers: { 'x-captcha-response': token } }),
      );
      this.ref.close(true);
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 429 ? 'Too many reports in a short time. Try again in a minute.' : 'Could not send the report. Please try again.');
    } finally {
      this.sending.set(false);
    }
  }
}
