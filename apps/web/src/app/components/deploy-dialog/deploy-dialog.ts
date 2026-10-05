import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { type CloudflareAccount, type Deployment, WORKER_NAME_PATTERN } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CloudflareApi } from '../../api/cloudflare';
import { DeploymentsApi } from '../../api/deployments';

export interface DeployDialogData {
  /** The repo's path, `owner/slug`. */
  path: string;
  /** Default Worker name. */
  slug: string;
  name: string;
  version: string;
  /** Secret names from the repo's deploy manifest (D3). */
  secrets: string[];
  /** #54: container apps need Workers Paid and bill container time to the buyer. */
  container?: boolean;
}

const ERRORS: Record<string, string> = {
  not_connected: 'Your Cloudflare account is not connected.',
  reconnect: 'Cloudflare no longer accepts the connection. Reconnect your account.',
  account_not_connected: 'That account is not available to this connection.',
  purchase_required: 'This app has to be purchased before it can be deployed.',
  rate_limited: 'Too many deploys in a short time. Try again in a minute.',
};

/**
 * PRD D6: choose the account, Worker name and secret values, then start a deploy. Closes with the
 * new deployment. Secret values go to the API once and are not kept in the page.
 */
@Component({
  selector: 'app-deploy-dialog',
  imports: [MatIconModule, ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule],
  templateUrl: './deploy-dialog.html',
  styleUrl: './deploy-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeployDialog {
  protected readonly data = inject<DeployDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DeployDialog, Deployment>>(MatDialogRef);
  private readonly cloudflare = inject(CloudflareApi);
  private readonly deployments = inject(DeploymentsApi);

  /** undefined while loading, null when the buyer has to connect (or reconnect) first. */
  protected readonly accounts = signal<CloudflareAccount[] | null | undefined>(undefined);
  protected readonly connectUrl = this.cloudflare.connectUrl(`/${this.data.path}?deploy=1`);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    accountId: ['', Validators.required],
    workerName: [this.data.slug.slice(0, 63), [Validators.required, Validators.pattern(WORKER_NAME_PATTERN)]],
    secrets: inject(FormBuilder).nonNullable.group(
      Object.fromEntries(this.data.secrets.map((name) => [name, new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(5120)] })])),
    ),
  });

  async ngOnInit(): Promise<void> {
    try {
      const accounts = await firstValueFrom(this.cloudflare.accounts());
      this.accounts.set(accounts);
      if (accounts.length === 1) this.form.controls.accountId.setValue(accounts[0]!.id);
    } catch {
      this.accounts.set(null);
    }
  }

  protected async deploy(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    const { accountId, workerName, secrets } = this.form.getRawValue();
    try {
      const deployment = await firstValueFrom(this.deployments.start(this.data.path, { accountId, workerName, secrets }));
      this.form.controls.secrets.reset();
      this.ref.close(deployment);
    } catch (e) {
      const code = e instanceof HttpErrorResponse ? (e.error?.error as string | undefined) : undefined;
      if (code === 'not_connected' || code === 'reconnect') this.accounts.set(null);
      const reason = e instanceof HttpErrorResponse && code === 'not_deployable' ? (e.error?.reason as string) : null;
      this.error.set(reason ?? ERRORS[code ?? ''] ?? 'Could not start the deploy. Try again.');
    } finally {
      this.sending.set(false);
    }
  }
}
