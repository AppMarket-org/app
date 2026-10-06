import { NotFoundView } from '../../components/not-found-view/not-found-view';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Checkpoint } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CheckpointsApi } from '../../api/checkpoints';
import { CheckpointDetails } from '../../components/checkpoint-details/checkpoint-details';
import { HARNESS_LABELS, builtWith, groupBySession, summaryLine } from '../../components/checkpoint-details/timeline';
import { Seo } from '../../seo/seo';
import type { HistoryData } from './history-resolver';

/** #117 (G7): the build history buyers see: published checkpoints only, server-rendered. */
@Component({
  selector: 'app-history',
  imports: [NotFoundView, DatePipe, RouterLink, CheckpointDetails, MatButtonModule, MatCardModule, MatExpansionModule, MatIconModule],
  templateUrl: './history.html',
  styleUrl: './history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  private readonly api = inject(CheckpointsApi);
  protected readonly data = inject(ActivatedRoute).snapshot.data['history'] as HistoryData | null;
  protected readonly harnesses = HARNESS_LABELS;
  protected readonly short = (sha: string) => sha.slice(0, 7);
  protected readonly items = signal<Checkpoint[]>(this.data?.page.items ?? []);
  protected readonly next = signal<string | null>(this.data?.page.next ?? null);
  protected readonly groups = computed(() => groupBySession(this.items()));
  protected readonly summary = this.data?.page.summary ? summaryLine(this.data.page.summary) : '';
  protected readonly builtWith = this.data?.page.summary ? builtWith(this.data.page.summary) : '';

  constructor() {
    const seo = inject(Seo);
    const route = inject(ActivatedRoute).snapshot;
    const repo = this.data?.repo;
    if (!repo) {
      seo.set({ title: 'App not found', description: 'This app does not exist or is not published.', path: `/${route.paramMap.get('owner') ?? ''}/${route.paramMap.get('slug') ?? ''}/history`, noindex: true });
      return;
    }
    seo.set({
      title: `Build history · ${repo.name}`,
      description: `The prompts, agents and models behind ${repo.name}${this.summary ? `: ${this.summary}` : ''}.`,
      path: `/${repo.fullName}/history`,
      heading: [{ label: repo.owner.handle, link: `/${repo.owner.handle}` }, { label: repo.slug, link: `/${repo.fullName}` }, { label: 'history' }],
      noindex: repo.state !== 'published',
    });
  }

  protected preview(c: Checkpoint): string {
    const text = c.prompts?.at(-1)?.text;
    if (!text) return c.harness === 'none' ? 'Manual commit' : 'Prompt not published';
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }

  protected async more(): Promise<void> {
    const before = this.next();
    if (!before || !this.data) return;
    const page = await firstValueFrom(this.api.list(this.data.repo.fullName, { view: 'public', before, limit: 50 }));
    this.items.update((items) => [...items, ...page.items]);
    this.next.set(page.next);
  }
}
