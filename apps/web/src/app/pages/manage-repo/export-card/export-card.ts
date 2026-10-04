import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { RepoExport } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { exportScript } from './export-script';

/** #31 (R25): take the code and every release file elsewhere. */
@Component({
  selector: 'app-export-card',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule],
  templateUrl: './export-card.html',
  styleUrl: './export-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportCard {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly busy = signal(false);
  protected readonly script = signal<string | null>(null);
  protected readonly summary = signal('');

  protected async prepare(): Promise<void> {
    this.busy.set(true);
    try {
      const exp = await firstValueFrom(this.http.get<RepoExport>(`/api/repos/${this.path()}/export`));
      this.script.set(exportScript(exp));
      this.summary.set(`${exp.releases.length} release file${exp.releases.length === 1 ? '' : 's'}${exp.gitRemote ? ' and the Git repository' : ''}; links work for an hour.`);
    } catch {
      this.snackBar.open('Could not prepare the export.', 'OK', { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(): void {
    const s = this.script();
    if (s) this.snackBar.open(this.clipboard.copy(s) ? 'Script copied' : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }
}
