import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { MemoryChange, MemoryNote, MemorySuggestion } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { MemoryApi, type NoteChange } from '../../api/memory';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { MemorySuggestions } from '../../components/memory-suggestions/memory-suggestions';
import { RepositoryHeader } from '../../components/repository-header/repository-header';
import { RepositoryNav } from '../../components/repository-nav/repository-nav';
import { Seo } from '../../seo/seo';

const SOURCE_LABELS: Record<string, string> = { web: 'website', cli: 'CLI', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode', mcp: 'an agent', other: 'other' };

/** #198: the repo's memory: notes its people and agents keep, with history; some published with the app. */
@Component({
  selector: 'app-memory',
  imports: [RepositoryHeader, RepositoryNav, DatePipe, MemorySuggestions, RouterLink, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './memory.html',
  styleUrl: './memory.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryPage implements OnInit {
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);
  private readonly api = inject(MemoryApi);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly notes = signal<MemoryNote[] | null | undefined>(undefined);
  protected readonly total = signal(0);
  protected readonly suggestions = signal<MemorySuggestion[]>([]);
  protected readonly limit = signal(500);
  protected readonly query = signal('');
  protected readonly tag = signal('');
  protected readonly busy = signal(false);
  protected readonly draft = signal({ text: '', tags: '', pinned: false, public: false });
  protected readonly editing = signal<{ id: string; text: string; tags: string } | null>(null);
  protected readonly history = signal<Record<string, MemoryChange[] | undefined>>({});
  protected readonly sources = SOURCE_LABELS;
  protected readonly allTags = computed(() => [...new Set((this.notes() ?? []).flatMap((n) => n.tags))].sort());

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'Memory', description: "The repo's notes for its agents and people.", path: '/', noindex: true });
    effect(() => seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: `/dashboard/repos/${this.path()}` }, { label: 'Memory' }]));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      const [r, s] = await Promise.all([firstValueFrom(this.api.list(this.path(), this.query().trim(), this.tag())), firstValueFrom(this.api.suggestions(this.path())).catch(() => ({ items: [] }))]);
      this.suggestions.set(s.items);
      this.notes.set(r.notes);
      this.total.set(r.total);
      this.limit.set(r.limits.notesPerRepo);
    } catch {
      this.notes.set(null);
    }
  }

  protected async filterTag(tag: string): Promise<void> {
    this.tag.set(this.tag() === tag ? '' : tag);
    await this.load();
  }

  protected tagsOf(input: string): string[] {
    return input
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);
  }

  private async run(work: () => Promise<unknown>, done?: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await work();
      if (done) this.snackBar.open(done, undefined, { duration: 2500 });
      await this.load();
      return true;
    } catch (e) {
      this.snackBar.open(e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'That did not work. Try again.', 'OK', { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async add(): Promise<void> {
    const d = this.draft();
    if (!d.text.trim()) return;
    if (await this.run(() => firstValueFrom(this.api.create(this.path(), { text: d.text, tags: this.tagsOf(d.tags), pinned: d.pinned, public: d.public })), 'Note added')) {
      this.draft.set({ text: '', tags: '', pinned: false, public: false });
    }
  }

  protected async change(note: MemoryNote, change: NoteChange): Promise<void> {
    await this.run(() => firstValueFrom(this.api.update(this.path(), note.id, change)));
  }

  protected edit(note: MemoryNote): void {
    this.editing.set({ id: note.id, text: note.text, tags: note.tags.join(', ') });
  }

  protected async save(note: MemoryNote): Promise<void> {
    const e = this.editing();
    if (!e || !e.text.trim()) return;
    if (await this.run(() => firstValueFrom(this.api.update(this.path(), note.id, { text: e.text, tags: this.tagsOf(e.tags) })), 'Note saved')) this.editing.set(null);
  }

  protected async remove(note: MemoryNote): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: { title: 'Delete this note?', message: 'Agents stop seeing it. Its history is kept.', confirm: 'Delete' }, width: '28rem' })
        .afterClosed(),
    );
    if (ok) await this.run(() => firstValueFrom(this.api.remove(this.path(), note.id)), 'Note deleted');
  }

  protected async toggleHistory(note: MemoryNote): Promise<void> {
    const shown = this.history()[note.id];
    if (shown) {
      this.history.set({ ...this.history(), [note.id]: undefined });
      return;
    }
    const r = await firstValueFrom(this.api.history(this.path(), note.id)).catch(() => ({ items: [] }));
    this.history.set({ ...this.history(), [note.id]: r.items });
  }
}
