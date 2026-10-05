import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CONFIG_NAME, type WorkerConfig } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

type Config = WorkerConfig & { audit: { kind: string; name: string; action: string; created_at: string; user: string }[] };
const message = (error: unknown) => (error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined);

/**
 * #51 (D13): the deployed Worker's plain variables (with values) and secrets (names only).
 * Changes go to the buyer's Worker and deploy a new version; secret values are never shown.
 */
@Component({
  selector: 'app-config-card',
  imports: [DatePipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatChipsModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule],
  templateUrl: './config-card.html',
  styleUrl: './config-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigCard {
  readonly deploymentId = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly config = signal<Config | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly kind = signal<'vars' | 'secrets'>('vars');
  protected readonly name = signal('');
  protected readonly value = signal('');
  protected readonly validName = computed(() => CONFIG_NAME.test(this.name().trim()));

  ngOnInit(): void {
    void this.load();
  }

  /** Fill the form to change a variable or set a secret. */
  protected edit(kind: 'vars' | 'secrets', name: string, value = ''): void {
    this.kind.set(kind);
    this.name.set(name);
    this.value.set(value);
  }

  protected async save(): Promise<void> {
    const name = this.name().trim();
    await this.act(() => this.http.put(`/api/deployments/${this.deploymentId()}/config/${this.kind()}/${name}`, { value: this.value() }), `${name} saved and deployed`);
    this.name.set('');
    this.value.set('');
  }

  protected async remove(kind: 'vars' | 'secrets', name: string): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: { title: `Delete ${name}?`, message: 'The app is redeployed without it right away.', confirm: 'Delete' }, width: '28rem' })
        .afterClosed(),
    );
    if (ok) await this.act(() => this.http.delete(`/api/deployments/${this.deploymentId()}/config/${kind}/${name}`), `${name} deleted`);
  }

  private async act(request: () => ReturnType<HttpClient['delete']>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(request());
      this.snackBar.open(done, undefined, { duration: 3000 });
      await this.load();
    } catch (error) {
      this.snackBar.open(message(error) ?? 'That did not work.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.config.set(await firstValueFrom(this.http.get<Config>(`/api/deployments/${this.deploymentId()}/config`)));
      this.error.set(null);
    } catch (error) {
      this.error.set(message(error) ?? 'Could not load the configuration from Cloudflare.');
    }
  }
}
