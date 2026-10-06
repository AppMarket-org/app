import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { ISSUE_LIMITS, ISSUE_PRIORITIES, ISSUE_TYPES, ISSUE_TYPE_LABELS, type IssuePriority, type IssueType } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { IssuesApi } from '../../../api/issues';
import { Auth } from '../../../auth/auth';
import { IssueTypeBadge } from '../../../components/issue-type/issue-type';
import { MarkdownEditor } from '../../../components/markdown-editor/markdown-editor';
import { Seo } from '../../../seo/seo';
import { PRIORITY_LABELS } from '../labels';

/** #295: a new issue, like GitHub's: title, description, assignee (a person or Agents), type and priority. */
@Component({
  selector: 'app-new-issue',
  imports: [FormsModule, IssueTypeBadge, MarkdownEditor, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressBarModule, RouterLink],
  templateUrl: './new-issue.html',
  styleUrl: './new-issue.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewIssuePage {
  private readonly api = inject(IssuesApi);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly type = signal<IssueType | null>(null);
  protected readonly priority = signal<IssuePriority>('none');
  /** A handle, "agents", or null. */
  protected readonly assignee = signal<string | null>(null);
  protected readonly more = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly types = ISSUE_TYPES;
  protected readonly typeLabels = ISSUE_TYPE_LABELS;
  protected readonly priorities = ISSUE_PRIORITIES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly limits = ISSUE_LIMITS;
  protected readonly me = computed(() => this.auth.owner()?.handle ?? null);
  protected readonly assigneeLabel = computed(() => (this.assignee() === 'agents' ? 'Agents' : this.assignee() === this.me() && this.me() ? this.auth.owner()!.name || this.me()! : 'Assignee'));
  private readonly editor = viewChild(MarkdownEditor);

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'New issue', description: 'Report a bug, propose a feature, or describe a task.', path: '/', noindex: true });
    effect(() => seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: `/${this.path}/issues` }, { label: 'New issue' }]));
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }

  protected async create(): Promise<void> {
    if (!this.title().trim() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const issue = await firstValueFrom(
        this.api.create(this.path, { title: this.title(), body: this.body(), type: this.type() ?? 'task', priority: this.priority(), assignee: this.assignee() }),
      );
      if (this.more()) {
        this.snackBar.open(`Issue #${issue.number} created`, 'View', { duration: 5000 }).onAction().subscribe(() => void this.router.navigate(['/', this.owner(), this.slug(), 'issues', issue.number]));
        this.title.set('');
        this.body.set('');
        this.editor()?.focus();
      } else {
        await this.router.navigate(['/', this.owner(), this.slug(), 'issues', issue.number]);
      }
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'The issue could not be created. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
