import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import type { PullChecks, PullComment, PullRequest, PullReview } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../../auth/auth';
import { type FileDiff, type PullFiles, PullsApi } from '../../../api/pulls';
import { DiffView } from '../../../components/diff-view/diff-view';
import { Markdown } from '../../../components/markdown/markdown';
import { Seo } from '../../../seo/seo';

type TimelineItem = { kind: 'comment'; at: string; comment: PullComment } | { kind: 'review'; at: string; review: PullReview };

const IN_FLIGHT = new Set(['queued', 'rebasing', 'checking', 'merging']);

/** #259: one pull request: conversation, commits, files changed, reviews and merging. */
@Component({
  selector: 'app-pull',
  imports: [
    DatePipe,
    DiffView,
    FormsModule,
    Markdown,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatTabsModule,
    RouterLink,
  ],
  templateUrl: './pull.html',
  styleUrl: './pull.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PullPage implements OnInit {
  private readonly api = inject(PullsApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  readonly number = input.required<string>();

  protected readonly pull = signal<PullRequest | null | undefined>(undefined);
  protected readonly comments = signal<PullComment[]>([]);
  protected readonly reviews = signal<PullReview[]>([]);
  protected readonly files = signal<PullFiles | null | undefined>(undefined);
  protected readonly diffs = signal<Record<string, FileDiff | null>>({});
  protected readonly busy = signal(false);
  protected draft = '';
  protected reviewDraft = '';

  protected readonly timeline = computed<TimelineItem[]>(() =>
    [
      ...this.comments()
        .filter((c) => !c.reviewId)
        .map((c): TimelineItem => ({ kind: 'comment', at: c.createdAt, comment: c })),
      ...this.reviews().map((r): TimelineItem => ({ kind: 'review', at: r.createdAt, review: r })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  );
  protected readonly merging = computed(() => !!this.pull()?.merge && IN_FLIGHT.has(this.pull()!.merge!.status));
  protected readonly checking = computed(() => this.pull()?.state === 'open' && ['queued', 'running'].includes(this.pull()?.checks?.status ?? ''));

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(Seo).set({ title: 'Pull request', description: 'Proposed changes.', path: '/', noindex: true });
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }
  private get n(): number {
    return Number(this.number());
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadConversation()]);
  }

  private async load(): Promise<void> {
    try {
      this.pull.set(await firstValueFrom(this.api.get(this.path, this.n)));
    } catch {
      this.pull.set(null);
    }
    // Follow a merge, or the checks, while they run.
    if (this.timer) clearTimeout(this.timer);
    if (this.merging() || this.checking()) this.timer = setTimeout(() => void this.load(), 5000);
  }

  private async loadConversation(): Promise<void> {
    const c = await firstValueFrom(this.api.conversation(this.path, this.n)).catch(() => ({ comments: [], reviews: [] }));
    this.comments.set(c.comments);
    this.reviews.set(c.reviews);
  }

  protected async loadFiles(): Promise<void> {
    if (this.files() !== undefined) return;
    this.files.set(await firstValueFrom(this.api.files(this.path, this.n)).catch(() => null));
  }

  protected async loadDiff(path: string): Promise<void> {
    if (path in this.diffs()) return;
    const diff = await firstValueFrom(this.api.diff(this.path, this.n, path)).catch(() => null);
    this.diffs.update((d) => ({ ...d, [path]: diff }));
  }

  protected async comment(): Promise<void> {
    if (!this.draft.trim()) return;
    await this.run(async () => {
      await firstValueFrom(this.api.comment(this.path, this.n, { body: this.draft.trim() }));
      this.draft = '';
      await this.loadConversation();
    });
  }

  protected async lineComment(c: { path: string; line: number; side: 'old' | 'new'; body: string }): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.comment(this.path, this.n, c));
      await this.loadConversation();
    });
  }

  protected async remove(c: PullComment): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.deleteComment(this.path, this.n, c.id));
      await this.loadConversation();
    });
  }

  protected async review(event: 'comment' | 'approve' | 'request_changes'): Promise<void> {
    await this.run(async () => {
      this.pull.set(await firstValueFrom(this.api.review(this.path, this.n, event, this.reviewDraft.trim())));
      this.reviewDraft = '';
      await this.loadConversation();
    });
  }

  protected async merge(): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.merge(this.path, this.n));
      await this.load();
    });
  }

  protected async setState(state: 'open' | 'closed'): Promise<void> {
    await this.run(async () => {
      this.pull.set(await firstValueFrom(this.api.update(this.path, this.n, { state })));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      const message = e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'That did not work.';
      this.snackBar.open(message, undefined, { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected reviewLabel(r: PullReview): string {
    return r.state === 'approved' ? 'approved these changes' : r.state === 'changes_requested' ? 'requested changes' : 'reviewed';
  }

  protected checksLabel(checks: PullChecks): string {
    if (checks.status === 'passed') return 'Checks passed';
    if (checks.status === 'failed') return checks.failed.length ? `Checks failed: ${checks.failed.join(', ')}` : 'Checks failed';
    if (checks.status === 'error') return 'Checks could not run';
    return checks.status === 'queued' ? 'Checks queued' : 'Checks running';
  }

  protected mergeLabel(status: string): string {
    return { queued: 'Merge queued', rebasing: 'Rebasing onto the target branch', checking: 'Running checks', merging: 'Merging', merged: 'Merged', conflict: 'Conflicts', failed: 'Not merged' }[status] ?? status;
  }
}
