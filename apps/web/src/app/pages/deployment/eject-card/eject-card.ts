import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

interface Eject {
  repo: string;
  version: string;
  commit: string;
  wranglerJson: string;
  guide: string;
  downloadUrl: string;
  expiresAt: string;
}

/** #41 (D11): take the deployed app and keep deploying it without appmarket.org. */
@Component({
  selector: 'app-eject-card',
  imports: [MatButtonModule, MatCardModule, MatExpansionModule, MatIconModule, MatProgressBarModule],
  templateUrl: './eject-card.html',
  styleUrl: './eject-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EjectCard {
  readonly deploymentId = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly eject = signal<Eject | null>(null);
  protected readonly busy = signal(false);

  protected async prepare(): Promise<void> {
    this.busy.set(true);
    try {
      this.eject.set(await firstValueFrom(this.http.get<Eject>(`/api/deployments/${this.deploymentId()}/eject`)));
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
      this.snackBar.open(message ?? 'Could not prepare the eject.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(text: string, what: string): void {
    this.snackBar.open(this.clipboard.copy(text) ? `${what} copied` : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }
}
