import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

interface CheckRun {
  id: string;
  commit: string;
  trigger: 'push' | 'submit';
  status: 'queued' | 'running' | 'passed' | 'failed' | 'error';
  results: { name: string; status: 'passed' | 'failed' | 'skipped'; output: string }[] | null;
  createdAt: string;
}

const ICONS = { passed: 'check_circle', failed: 'cancel', skipped: 'remove_circle_outline', queued: 'schedule', running: 'autorenew', error: 'error' } as const;

/** #27: automated checks of pushed and submitted commits; a submitted version publishes only when they passed. */
@Component({
  selector: 'app-checks-card',
  imports: [DatePipe, MatCardModule, MatChipsModule, MatExpansionModule, MatIconModule],
  templateUrl: './checks-card.html',
  styleUrl: './checks-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecksCard {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  protected readonly runs = signal<CheckRun[] | null>(null);
  protected readonly icons = ICONS;
  protected readonly short = (sha: string) => sha.slice(0, 7);

  constructor() {
    // Refresh while a run is in progress.
    const timer = setInterval(() => {
      if (this.runs()?.some((r) => r.status === 'queued' || r.status === 'running')) void this.load();
    }, 10_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.runs.set((await firstValueFrom(this.http.get<{ items: CheckRun[] }>(`/api/repos/${this.path()}/checks`)).catch(() => ({ items: [] }))).items);
  }
}
