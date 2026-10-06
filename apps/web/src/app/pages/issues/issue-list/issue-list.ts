import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { ISSUE_TYPES, ISSUE_TYPE_LABELS, type Issue, type IssueState, type IssueType } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { IssuesApi } from '../../../api/issues';
import { Auth } from '../../../auth/auth';
import { IssueTypeBadge } from '../../../components/issue-type/issue-type';
import { RepositoryHeader } from '../../../components/repository-header/repository-header';
import { RepositoryNav } from '../../../components/repository-nav/repository-nav';
import { Seo } from '../../../seo/seo';
import { PRIORITY_LABELS, assigneeLabel, stateIcon } from '../labels';

/** #295: a repo's issues. */
@Component({
  selector: 'app-issue-list',
  imports: [RepositoryHeader, RepositoryNav, DatePipe, IssueTypeBadge, MatButtonModule, MatButtonToggleModule, MatChipsModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './issue-list.html',
  styleUrl: './issue-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueListPage implements OnInit {
  private readonly api = inject(IssuesApi);
  protected readonly auth = inject(Auth);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly managed = computed(() => this.auth.owner()?.handle === this.owner() || this.auth.orgs().some((m) => m.org.handle === this.owner()));
  protected readonly state = signal<IssueState>('open');
  protected readonly type = signal<IssueType | null>(null);
  protected readonly agentsOnly = signal(false);
  protected readonly items = signal<Issue[] | null | undefined>(undefined);
  protected readonly counts = signal<Partial<Record<IssueState, number>>>({});
  protected readonly types = ISSUE_TYPES;
  protected readonly typeLabels = ISSUE_TYPE_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly assigneeLabel = assigneeLabel;
  protected readonly stateIcon = stateIcon;

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'Issues', description: 'Bugs, features and tasks for this repo.', path: '/', noindex: true });
    effect(() => seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: (this.managed() ? '/dashboard/repos/' : '/') + this.path }]));
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async show(state: IssueState): Promise<void> {
    this.state.set(state);
    await this.load();
  }

  protected async filterType(type: IssueType | null): Promise<void> {
    this.type.set(type);
    await this.load();
  }

  protected async filterAgents(on: boolean): Promise<void> {
    this.agentsOnly.set(on);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.list(this.path, { state: this.state(), type: this.type() ?? undefined, assignee: this.agentsOnly() ? 'agents' : undefined }));
      this.items.set(r.items);
      this.counts.set(r.counts);
    } catch {
      this.items.set(null);
    }
  }
}
