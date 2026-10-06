import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { AgentSession } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog';

/** #29 (R9), #309: agent sessions, working in the repo on their own branches (older ones in a fork). */
@Component({
  selector: 'app-sessions-card',
  imports: [DatePipe, RouterLink, MatButtonModule, MatCardModule, MatIconModule, MatListModule],
  templateUrl: './sessions-card.html',
  styleUrl: './sessions-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsCard {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly sessions = signal<AgentSession[] | null>(null);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async end(s: AgentSession): Promise<void> {
    await this.act(() => this.http.post(`/api/sessions/${s.id}/end`, {}), 'Session ended; its sign-in is revoked');
  }

  protected async discard(s: AgentSession): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: 'Discard this session?', message: s.inRepo ? 'Its sign-in is revoked and the branches it created are deleted. Work you already merged stays.' : `Its fork ${s.fork} and everything pushed to it are deleted. Work you already merged stays.`, confirm: 'Discard' },
          width: '28rem',
        })
        .afterClosed(),
    );
    if (ok) await this.act(() => this.http.delete(`/api/sessions/${s.id}`), 'Session discarded');
  }

  private async act(request: () => ReturnType<HttpClient['post']>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(request());
      this.snackBar.open(done, undefined, { duration: 3000 });
      await this.load();
    } catch {
      this.snackBar.open('That did not work.', 'OK', { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ items: AgentSession[] }>(`/api/repos/${this.path()}/sessions`)).catch(() => ({ items: [] }));
    this.sessions.set(r.items.filter((s) => s.status !== 'discarded'));
  }
}
