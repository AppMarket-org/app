import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, inject, input, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

interface PullSettings {
  requireApproval: boolean;
  reviewAgentWork: boolean;
  upstreamSync: boolean;
}

/** #258/#73: how pull requests merge here, and (for a repo made from a template) template updates. */
@Component({
  selector: 'app-pull-settings-card',
  imports: [MatCardModule, MatSlideToggleModule],
  templateUrl: './pull-settings-card.html',
  styleUrl: './pull-settings-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PullSettingsCard implements OnInit {
  readonly path = input.required<string>();
  /** The template this repo was made from, if any. */
  readonly template = input<string | null>(null);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly settings = signal<PullSettings | null | undefined>(undefined);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    this.settings.set(await firstValueFrom(this.http.get<PullSettings>(`/api/repos/${this.path()}/pull-settings`)).catch(() => null));
  }

  protected async set(key: keyof PullSettings, value: boolean): Promise<void> {
    this.busy.set(true);
    try {
      this.settings.set(await firstValueFrom(this.http.put<PullSettings>(`/api/repos/${this.path()}/pull-settings`, { [key]: value })));
    } catch {
      this.snackBar.open('Could not save that setting. Try again.', undefined, { duration: 4000 });
      this.settings.set(this.settings() ? { ...this.settings()! } : null);
    } finally {
      this.busy.set(false);
    }
  }
}
