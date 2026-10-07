import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { A2A_KEY_DAYS, type A2AKey } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

/** Repo A2A keys: give an outside agent or orchestrator a key to post and follow this repo's tasks. */
@Component({
  selector: 'app-a2a-keys-card',
  imports: [DatePipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatSelectModule],
  templateUrl: './a2a-keys-card.html',
  styleUrl: './a2a-keys-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class A2aKeysCard {
  /** owner/slug */
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly clipboard = inject(Clipboard);

  protected readonly days = A2A_KEY_DAYS;
  protected readonly keys = signal<A2AKey[] | null>(null);
  protected readonly name = signal('');
  protected readonly expiry = signal<number>(90);
  protected readonly busy = signal(false);
  /** The key just created, shown once. */
  protected readonly created = signal<string | null>(null);
  protected readonly canCreate = computed(() => !this.busy() && this.name().trim().length > 0 && this.name().length <= 80);
  protected readonly endpoint = computed(() => `https://appmarket.org/api/repos/${this.path()}/a2a`);
  protected readonly example = computed(
    () =>
      `curl -X POST ${this.endpoint()} \\\n  -H "Authorization: Bearer ${this.created() ?? '$APPMARKET_A2A_KEY'}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"Add a /health endpoint"}]}}}'`,
  );

  ngOnInit(): void {
    void this.load();
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.post<{ key: string }>(`/api/repos/${this.path()}/a2a-keys`, { name: this.name().trim(), days: this.expiry() }));
      this.created.set(r.key);
      this.name.set('');
      await this.load();
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
      this.snackBar.open(message ?? 'Could not create the key.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(key: A2AKey): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: `Revoke “${key.name}”?`, message: 'Anything using this key can no longer post or follow tasks on this repo.', confirm: 'Revoke key' },
          width: '28rem',
        })
        .afterClosed(),
    );
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(`/api/repos/${this.path()}/a2a-keys/${key.id}`));
      this.snackBar.open(`“${key.name}” revoked`, undefined, { duration: 3000 });
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(text: string, what: string): void {
    this.clipboard.copy(text);
    this.snackBar.open(`${what} copied`, undefined, { duration: 2000 });
  }

  private async load(): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ items: A2AKey[] }>(`/api/repos/${this.path()}/a2a-keys`)).catch(() => null);
    this.keys.set(r?.items ?? []);
  }
}
