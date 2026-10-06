import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, inject, input, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

interface PullSettings {
  requireApproval: boolean;
  reviewAgentWork: boolean;
  upstreamSync: boolean;
  protectedBranches: string[];
}

/** #258/#73: how pull requests merge here, and (for a repo made from a template) template updates. */
@Component({
  selector: 'app-pull-settings-card',
  imports: [MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatSlideToggleModule],
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

  protected async addBranch(event: MatChipInputEvent): Promise<void> {
    const name = event.value.trim();
    event.chipInput.clear();
    const current = this.settings()?.protectedBranches ?? [];
    if (name && !current.includes(name)) await this.save({ protectedBranches: [...current, name] });
  }

  protected async removeBranch(name: string): Promise<void> {
    await this.save({ protectedBranches: (this.settings()?.protectedBranches ?? []).filter((b) => b !== name) });
  }

  protected async set(key: 'requireApproval' | 'reviewAgentWork' | 'upstreamSync', value: boolean): Promise<void> {
    await this.save({ [key]: value });
  }

  private async save(change: Partial<PullSettings>): Promise<void> {
    this.busy.set(true);
    try {
      this.settings.set(await firstValueFrom(this.http.put<PullSettings>(`/api/repos/${this.path()}/pull-settings`, change)));
    } catch {
      this.snackBar.open('Could not save that setting. Try again.', undefined, { duration: 4000 });
      this.settings.set(this.settings() ? { ...this.settings()! } : null);
    } finally {
      this.busy.set(false);
    }
  }
}
