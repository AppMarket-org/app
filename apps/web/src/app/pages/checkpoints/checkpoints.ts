import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { CHECKPOINT_VISIBILITIES, effortLevelLabel, type Checkpoint, type CheckpointVisibility, type Repo } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { CheckpointsApi } from '../../api/checkpoints';
import { Developer } from '../../api/developer';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { NoteDialog, type NoteDialogData } from '../../components/note-dialog/note-dialog';
import { Seo } from '../../seo/seo';
import { HARNESS_LABELS, VISIBILITY_LABELS, effortLine, groupBySession, type SessionGroup } from './timeline';

const REFRESH_MS = 10_000;
const PAGE = 50;

/** #116: the developer's checkpoint timeline for one repo, grouped by agent session. */
@Component({
  selector: 'app-checkpoints',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './checkpoints.html',
  styleUrl: './checkpoints.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckpointsPage {
  /** From the route /dashboard/repos/:owner/:slug/checkpoints. */
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);

  private readonly api = inject(CheckpointsApi);
  private readonly developer = inject(Developer);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);
  private readonly document = inject(DOCUMENT);

  protected readonly harnesses = HARNESS_LABELS;
  protected readonly visibilities = VISIBILITY_LABELS;
  protected readonly visibilityOptions = CHECKPOINT_VISIBILITIES;
  protected readonly effortLine = effortLine;
  protected readonly effortLabel = effortLevelLabel;
  protected readonly short = (sha: string) => sha.slice(0, 7);

  protected readonly repo = signal<Repo | null>(null);
  protected readonly items = signal<Checkpoint[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly groups = computed<SessionGroup[]>(() => groupBySession(this.items()));
  protected readonly summary = computed(() => {
    const items = this.items();
    const agent = items.filter((c) => c.harness !== 'none').length;
    return `${items.length} commit${items.length === 1 ? '' : 's'}${this.next() ? '+' : ''}, ${agent} by an agent, ${items.length - agent} manual`;
  });
  protected readonly notesCommand = 'git log --notes=appmarket';

  constructor() {
    inject(Seo).set({ title: 'Checkpoints', description: 'The prompts behind your commits.', path: '/dashboard', noindex: true, heading: [{ label: 'Dashboard', link: '/dashboard' }] });
    // New commits show up within 10 s while the page is open and visible.
    const timer = setInterval(() => {
      if (this.document.visibilityState === 'visible' && !this.loading()) void this.refresh();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [repo, page] = await Promise.all([firstValueFrom(this.developer.repo(this.path())), firstValueFrom(this.api.list(this.path(), { limit: PAGE }))]);
      this.repo.set(repo);
      this.items.set(page.items);
      this.next.set(page.next);
      this.loadError.set(false);
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Reloads what is shown (up to 100 checkpoints). */
  protected async refresh(): Promise<void> {
    try {
      const page = await firstValueFrom(this.api.list(this.path(), { limit: Math.min(Math.max(this.items().length, PAGE), 100) }));
      this.items.set(page.items);
      this.next.set(page.next);
    } catch {
      // Offline or signed out: keep what is shown; the next tick retries.
    }
  }

  protected async more(): Promise<void> {
    const before = this.next();
    if (!before) return;
    const page = await firstValueFrom(this.api.list(this.path(), { before, limit: PAGE }));
    this.items.update((items) => [...items, ...page.items]);
    this.next.set(page.next);
  }

  protected async setDefault(visibility: CheckpointVisibility): Promise<void> {
    await this.act(async () => {
      await firstValueFrom(this.api.setDefault(this.path(), visibility));
      this.repo.update((r) => (r ? { ...r, checkpointVisibility: visibility } : r));
    }, `New checkpoints: ${VISIBILITY_LABELS[visibility].label.toLowerCase()}`);
  }

  protected async setVisibility(c: Checkpoint, visibility: CheckpointVisibility): Promise<void> {
    await this.act(async () => this.replace(await firstValueFrom(this.api.setVisibility(this.path(), c.commit, visibility))), `${this.short(c.commit)}: ${VISIBILITY_LABELS[visibility].label}`);
  }

  protected async setSessionVisibility(group: SessionGroup, visibility: CheckpointVisibility): Promise<void> {
    await this.act(async () => {
      await firstValueFrom(this.api.setSessionVisibility(this.path(), group.session, visibility));
      await this.refresh();
    }, `Session: ${VISIBILITY_LABELS[visibility].label}`);
  }

  protected async addPrompt(c: Checkpoint): Promise<void> {
    const data: NoteDialogData = {
      title: `Add a prompt to ${this.short(c.commit)}`,
      message: 'For a commit whose prompt was not captured. It is added as written; check it for secrets first.',
      label: 'Prompt',
      confirm: 'Add prompt',
      required: true,
      maxLength: 10_000,
    };
    const prompt = await firstValueFrom(this.dialog.open<NoteDialog, NoteDialogData, string>(NoteDialog, { data, width: '36rem' }).afterClosed());
    if (!prompt) return;
    await this.act(async () => this.replace(await firstValueFrom(this.api.addPrompt(this.path(), c.commit, prompt))), 'Prompt added');
  }

  protected async remove(c: Checkpoint): Promise<void> {
    const data: ConfirmDialogData = {
      title: `Delete the checkpoint for ${this.short(c.commit)}?`,
      message: 'The commit stays; its prompts, tools and usage are removed from appmarket.org. The git note on your machine is not touched.',
      confirm: 'Delete',
    };
    if (!(await firstValueFrom(this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data }).afterClosed()))) return;
    await this.act(async () => {
      await firstValueFrom(this.api.delete(this.path(), c.commit));
      this.items.update((items) => items.filter((i) => i.commit !== c.commit));
    }, 'Checkpoint deleted');
  }

  protected copy(text: string): void {
    this.snackBar.open(this.clipboard.copy(text) ? 'Command copied' : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }

  protected truncated(text: string, max = 160): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private replace(updated: Checkpoint): void {
    this.items.update((items) => items.map((i) => (i.commit === updated.commit ? updated : i)));
  }

  private async act(work: () => Promise<void>, done: string): Promise<void> {
    try {
      await work();
      this.snackBar.open(done, undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('That did not work. Try again.', 'OK', { duration: 5000 });
    }
  }
}
