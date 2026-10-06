import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';

export interface PlaneTask {
  id: string;
  title: string;
  description: string;
  capabilities: string[];
  status: 'open' | 'claimed' | 'done' | 'failed';
  claimedBy: string | null;
  branch: string | null;
  note: string | null;
  merge: TaskMerge | null;
  createdAt: string;
  updatedAt: string;
}
export interface TaskMerge {
  id: string;
  status: 'queued' | 'rebasing' | 'checking' | 'merging' | 'merged' | 'conflict' | 'failed' | 'review';
  sha: string | null;
  error: string | null;
  conflicts?: string[];
  /** The pull request opened for the task (review on). */
  pull?: number;
}

/** #238: what each merge stage is called on the board. */
export const MERGE_LABELS: Record<TaskMerge['status'], string> = {
  review: 'Waiting for review',
  queued: 'Merge queued',
  rebasing: 'Rebasing onto the base branch',
  checking: 'Running checks',
  merging: 'Merging',
  merged: 'Merged',
  conflict: 'Conflicts',
  failed: 'Not merged',
};

export interface PlaneAgent {
  id: string;
  name: string;
  vendor: string;
  capabilities: string[];
  lastSeen: string;
}
export interface PlaneLease {
  agentId: string;
  taskId: string | null;
  path: string;
  expiresAt: number;
}
export interface PlaneState {
  tasks: PlaneTask[];
  agents: PlaneAgent[];
  leases: PlaneLease[];
}

/**
 * #236: the collaboration board of a repo. The owner posts tasks; agents (each in its own agent
 * session) claim them and lease the paths they will touch. Updates arrive live over a WebSocket.
 */
@Component({
  selector: 'app-agents',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatSlideToggleModule,
    MatProgressBarModule,
    MatTooltipModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './agents.html',
  styleUrl: './agents.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  /** From the route /dashboard/repos/:owner/:slug/agents. */
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);

  protected readonly state = signal<PlaneState | null | undefined>(undefined);
  protected readonly live = signal(false);
  protected readonly saving = signal(false);
  protected readonly open = computed(() => this.state()?.tasks.filter((t) => t.status === 'open') ?? []);
  protected readonly claimed = computed(() => this.state()?.tasks.filter((t) => t.status === 'claimed') ?? []);
  protected readonly finished = computed(() => this.state()?.tasks.filter((t) => t.status === 'done' || t.status === 'failed') ?? []);
  private readonly names = computed(() => new Map((this.state()?.agents ?? []).map((a) => [a.id, a.name])));

  protected readonly mergeLabels = MERGE_LABELS;
  /** #260: finished tasks open a pull request for review instead of merging. */
  protected readonly reviewAgentWork = signal<boolean | null>(null);
  protected readonly merging = signal<string | null>(null);

  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(4000)] }),
    capabilities: new FormControl('', { nonNullable: true }),
  });

  private socket: WebSocket | null = null;
  private retry = 0;
  private closed = false;

  constructor() {
    inject(Seo).set({ title: 'Agents', description: 'Tasks and agents working on this repo.', path: '/dashboard', noindex: true, heading: [{ label: 'Dashboard', link: '/dashboard' }] });
    this.destroyRef.onDestroy(() => {
      this.closed = true;
      this.socket?.close();
    });
  }

  ngOnInit(): void {
    if (!this.browser) return;
    void this.refresh();
    void firstValueFrom(this.http.get<{ reviewAgentWork: boolean }>(`/api/repos/${this.path()}/pull-settings`))
      .then((s) => this.reviewAgentWork.set(s.reviewAgentWork))
      .catch(() => undefined);
    this.connect();
  }

  protected agentName(id: string | null): string {
    return (id && this.names().get(id)) || 'an agent that left';
  }

  protected leasesOf(agentId: string): PlaneLease[] {
    return this.state()?.leases.filter((l) => l.agentId === agentId) ?? [];
  }

  protected async post(): Promise<void> {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const { title, description, capabilities } = this.form.getRawValue();
    try {
      const state = await firstValueFrom(
        this.http.post<PlaneState>(`/api/repos/${this.path()}/plane/tasks`, {
          title,
          description,
          capabilities: capabilities.split(/[,\s]+/).filter(Boolean),
        }),
      );
      this.state.set(state);
      this.form.reset();
    } catch (error) {
      this.snackBar.open(error instanceof HttpErrorResponse && error.status === 429 ? 'Too many open tasks.' : 'Could not post the task.', undefined, { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(task: PlaneTask): Promise<void> {
    try {
      this.state.set(await firstValueFrom(this.http.delete<PlaneState>(`/api/repos/${this.path()}/plane/tasks/${task.id}`)));
    } catch {
      this.snackBar.open('Could not remove the task.', undefined, { duration: 4000 });
    }
  }

  protected inFlight(merge: TaskMerge | null): boolean {
    return !!merge && ['queued', 'rebasing', 'checking', 'merging'].includes(merge.status);
  }

  /** #238: merge again, after a conflict, failed checks or a moved base. */
  protected async merge(task: PlaneTask): Promise<void> {
    this.merging.set(task.id);
    try {
      this.state.set(await firstValueFrom(this.http.post<PlaneState>(`/api/repos/${this.path()}/plane/tasks/${task.id}/merge`, {})));
    } catch (error) {
      const message = error instanceof HttpErrorResponse && typeof error.error?.error === 'string' ? error.error.error : 'Could not start the merge.';
      this.snackBar.open(message, undefined, { duration: 4000 });
    } finally {
      this.merging.set(null);
    }
  }

  protected async setReview(on: boolean): Promise<void> {
    const before = this.reviewAgentWork();
    this.reviewAgentWork.set(on);
    try {
      const s = await firstValueFrom(this.http.put<{ reviewAgentWork: boolean }>(`/api/repos/${this.path()}/pull-settings`, { reviewAgentWork: on }));
      this.reviewAgentWork.set(s.reviewAgentWork);
    } catch {
      this.reviewAgentWork.set(before);
      this.snackBar.open('Could not save the setting.', undefined, { duration: 4000 });
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.state.set(await firstValueFrom(this.http.get<PlaneState>(`/api/repos/${this.path()}/plane`)));
    } catch {
      this.state.set(null);
    }
  }

  /** Live updates; reconnects with backoff (and reloads the board, in case it missed some). */
  private connect(): void {
    const loc = this.document.location;
    const ws = new WebSocket(`${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/repos/${this.path()}/plane/live`);
    this.socket = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.live.set(true);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as { type: string; state?: PlaneState };
        if (message.type === 'state' && message.state) this.state.set(message.state);
      } catch {
        // Not a board update.
      }
    };
    ws.onclose = () => {
      this.live.set(false);
      if (this.closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => {
        if (this.closed) return;
        void this.refresh();
        this.connect();
      }, delay);
    };
  }
}
