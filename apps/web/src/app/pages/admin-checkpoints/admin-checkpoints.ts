import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { Checkpoint, CheckpointPage } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CheckpointDetails } from '../../components/checkpoint-details/checkpoint-details';
import { HARNESS_LABELS, VISIBILITY_LABELS } from '../../components/checkpoint-details/timeline';
import { Seo } from '../../seo/seo';

/** #135: a moderator's view of a reported repo's checkpoints, private included; access is logged. */
@Component({
  selector: 'app-admin-checkpoints',
  imports: [CheckpointDetails, MatButtonModule, MatCardModule, MatChipsModule, MatExpansionModule, MatIconModule, MatProgressBarModule, RouterLink],
  templateUrl: './admin-checkpoints.html',
  styleUrl: './admin-checkpoints.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCheckpointsPage {
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  /** The open report this view is for (query parameter). */
  readonly report = input<string>('');

  private readonly http = inject(HttpClient);
  protected readonly items = signal<Checkpoint[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly harnesses = HARNESS_LABELS;
  protected readonly visibilities = VISIBILITY_LABELS;
  protected readonly short = (sha: string) => sha.slice(0, 7);

  constructor() {
    inject(Seo).set({ title: 'Checkpoints (moderation)', description: 'Moderator view.', path: '/admin', noindex: true, heading: [{ label: 'Admin', link: '/admin' }] });
  }

  ngOnInit(): void {
    void this.load(null);
  }

  protected async load(before: string | null): Promise<void> {
    this.loading.set(true);
    try {
      const params: Record<string, string> = { report: this.report() };
      if (before) params['before'] = before;
      const page = await firstValueFrom(this.http.get<CheckpointPage>(`/api/admin/repos/${this.owner()}/${this.slug()}/checkpoints`, { params }));
      this.items.update((items) => (before ? [...items, ...page.items] : page.items));
      this.next.set(page.next);
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 403 ? 'Open this view from an open report on this repo.' : 'Could not load the checkpoints.');
    } finally {
      this.loading.set(false);
    }
  }
}
