import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

type Topic = 'impacts' | 'pulls';

interface EmailPreferences {
  impacts: boolean;
  pulls: boolean;
  /** False until appmarket.org sends email in this environment. */
  sending: boolean;
}

/** #230: which emails the user gets. */
@Component({
  selector: 'app-email-card',
  imports: [MatCardModule, MatSlideToggleModule],
  templateUrl: './email-card.html',
  styleUrl: './email-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailCard implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly prefs = signal<EmailPreferences | null>(null);

  async ngOnInit(): Promise<void> {
    this.prefs.set(await firstValueFrom(this.http.get<EmailPreferences>('/api/me/email-preferences')).catch(() => null));
  }

  protected async set(topic: Topic, on: boolean): Promise<void> {
    const before = this.prefs();
    this.prefs.update((p) => (p ? { ...p, [topic]: on } : p));
    try {
      this.prefs.set(await firstValueFrom(this.http.put<EmailPreferences>('/api/me/email-preferences', { [topic]: on })));
    } catch {
      this.prefs.set(before);
      this.snackBar.open('Could not save the email setting.', undefined, { duration: 4000 });
    }
  }
}
