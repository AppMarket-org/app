import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { ISSUE_LIMITS, ISSUE_PRIORITIES, ISSUE_TYPES, ISSUE_TYPE_LABELS, type Issue, type IssueComment, type IssueInput, type IssueWork } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { IssuesApi } from '../../../api/issues';
import { Auth } from '../../../auth/auth';
import { IssueTypeBadge } from '../../../components/issue-type/issue-type';
import { Markdown } from '../../../components/markdown/markdown';
import { MarkdownEditor } from '../../../components/markdown-editor/markdown-editor';
import { Seo } from '../../../seo/seo';
import { PRIORITY_LABELS, assigneeLabel, stateIcon } from '../labels';

/** #295: one issue: description, comments, triage (assignee, type, priority) and closing. */
@Component({
  selector: 'app-issue',
  imports: [DatePipe, FormsModule, IssueTypeBadge, Markdown, MarkdownEditor, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressBarModule, RouterLink],
  templateUrl: './issue.html',
  styleUrl: './issue.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuePage implements OnInit {
  private readonly api = inject(IssuesApi);
  protected readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  readonly number = input.required<string>();
  protected readonly issue = signal<Issue | null | undefined>(undefined);
  protected readonly comments = signal<IssueComment[]>([]);
  protected readonly reply = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftBody = signal('');
  protected readonly types = ISSUE_TYPES;
  protected readonly typeLabels = ISSUE_TYPE_LABELS;
  protected readonly priorities = ISSUE_PRIORITIES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly limits = ISSUE_LIMITS;
  protected readonly assigneeLabel = assigneeLabel;
  protected readonly stateIcon = stateIcon;
  protected readonly me = computed(() => this.auth.owner()?.handle ?? null);
  protected readonly workIcon: Record<IssueWork['status'], string> = { open: 'schedule', claimed: 'smart_toy', review: 'rate_review', done: 'task_alt', failed: 'error_outline' };
  protected workLabel(w: IssueWork): string {
    const who = w.agent ?? 'An agent';
    return { open: 'Waiting for an agent', claimed: `${who} is working on it`, review: `${who} finished; waiting for review`, done: `${who} finished it`, failed: `${who} could not finish it` }[w.status];
  }

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'Issue', description: 'An issue on this repo.', path: '/', noindex: true });
    effect(() => {
      const i = this.issue();
      seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: `/${this.path}/issues` }, { label: i ? `#${i.number}` : 'Issue' }]);
    });
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }
  private get n(): number {
    return Number(this.number());
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadComments()]);
  }

  private async load(): Promise<void> {
    try {
      this.issue.set(await firstValueFrom(this.api.get(this.path, this.n)));
    } catch {
      this.issue.set(null);
    }
  }

  private async loadComments(): Promise<void> {
    const r = await firstValueFrom(this.api.comments(this.path, this.n)).catch(() => ({ items: [] }));
    this.comments.set(r.items);
  }

  private async run(work: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
      return true;
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'That did not work. Try again.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async update(input: IssueInput): Promise<void> {
    await this.run(async () => this.issue.set(await firstValueFrom(this.api.update(this.path, this.n, input))));
  }

  protected async comment(close?: 'completed' | 'not_planned'): Promise<void> {
    const text = this.reply().trim();
    const done = await this.run(async () => {
      if (text) await firstValueFrom(this.api.comment(this.path, this.n, text));
      if (close) this.issue.set(await firstValueFrom(this.api.update(this.path, this.n, { state: 'closed', reason: close })));
    });
    if (done) {
      this.reply.set('');
      await Promise.all([this.loadComments(), close ? Promise.resolve() : this.load()]);
    }
  }

  protected async reopen(): Promise<void> {
    await this.update({ state: 'open' });
  }

  protected async remove(c: IssueComment): Promise<void> {
    if (await this.run(() => firstValueFrom(this.api.deleteComment(this.path, this.n, c.id)))) await this.loadComments();
  }

  protected edit(issue: Issue): void {
    this.draftTitle.set(issue.title);
    this.draftBody.set(issue.body);
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    await this.update({ title: this.draftTitle(), body: this.draftBody() });
    if (!this.error()) this.editing.set(false);
  }
}
