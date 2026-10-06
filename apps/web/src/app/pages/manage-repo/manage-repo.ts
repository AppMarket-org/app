import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, type FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RepositoryNav } from '../../components/repository-nav/repository-nav';
import { CodePage } from '../code/code';
import { RUNTIMES, SCREENSHOT_LIMITS, canTransition, type Repo, type RepoEvent, type RepoInput, type RepoState, type GitToken, type Screenshot, type TokenRecord, type TransitionRequest } from '@appmarket/shared';
import { firstValueFrom, forkJoin } from 'rxjs';
import { Developer } from '../../api/developer';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { RepoForm, type RepoFormValue } from '../../components/repo-form/repo-form';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { ReleasesCard } from './releases-card/releases-card';
import { AndroidCard } from './android-card/android-card';
import { ChecksCard } from './checks-card/checks-card';
import { Conformance } from '../../components/conformance/conformance';
import { ExportCard } from './export-card/export-card';
import { PreviewsCard } from './previews-card/previews-card';
import { PriceCard } from './price-card/price-card';
import { SessionsCard } from './sessions-card/sessions-card';
import { WebhooksCard } from './webhooks-card/webhooks-card';
import { Seo } from '../../seo/seo';
import { describeRepoError } from '../repo-errors';
import { STATE_LABELS } from '../state-labels';

/** PRD R16/R12: one repo: its Git storage, push token, version submission, lifecycle actions and history. */
@Component({
  selector: 'app-manage-repo',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTableModule,
    RepoForm,
    AndroidCard,
    ChecksCard,
    Conformance,
    ExportCard,
    PreviewsCard,
    PriceCard,
    SessionsCard,
    WebhooksCard,
    ReleasesCard,
    RuntimeBadge,
    RepositoryNav,
    CodePage,
    MatMenuModule,
  ],
  templateUrl: './manage-repo.html',
  styleUrl: './manage-repo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageRepo {
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  protected readonly tab = computed(() => {
    const tab = this.query().get('tab');
    return tab === 'deployments' || tab === 'marketplace' || tab === 'settings' ? tab : 'code';
  });
  protected readonly visited = signal(new Set<string>());
  protected readonly fileOpen = computed(() => !!this.query().get('file'));
  /** From the route /dashboard/repos/:owner/:slug. */
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  /** The repo's path, `owner/slug`, as the API addresses it. */
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);

  private readonly api = inject(Developer);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);
  private readonly seo = inject(Seo);

  protected readonly states = STATE_LABELS;
  protected readonly repo = signal<Repo | null>(null);
  protected readonly runtimeName = (r: keyof typeof RUNTIMES) => RUNTIMES[r].name;
  protected readonly remote = signal<string | null>(null);
  protected readonly events = signal<RepoEvent[]>([]);
  protected readonly loadError = signal(false);
  protected readonly token = signal<GitToken | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitIssues = signal<string[]>([]);
  protected readonly screenshots = signal<Screenshot[]>([]);
  protected readonly tokens = signal<TokenRecord[]>([]);
  protected readonly editing = signal(false);
  protected readonly detailsError = signal<string | null>(null);
  protected readonly detailsFieldErrors = signal<Record<string, string>>({});
  protected readonly shotLimits = SCREENSHOT_LIMITS;
  protected readonly tokenColumns = ['scope', 'state', 'issuedTo', 'expires', 'actions'];
  protected readonly maxShotMb = SCREENSHOT_LIMITS.maxBytes / 1024 / 1024;
  protected readonly activeTokens = computed(() => this.tokens().filter((t) => t.state === 'active').length);

  protected readonly canSubmit = computed(() => this.can('submitted'));
  protected readonly pushCommands = computed(() => {
    const t = this.token();
    return t
      ? [`git remote add appmarket ${t.remote}`, `git -c http.extraHeader="Authorization: Bearer ${t.token}" push appmarket main --tags`]
      : [];
  });

  protected readonly submitForm = inject(FormBuilder).nonNullable.group({
    tag: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)]],
    releaseNotes: ['', [Validators.maxLength(10_000)]],
  });

  constructor() {
    effect(() => { this.visited.update((tabs) => new Set([...tabs, this.tab()])); });
    this.seo.set({ title: 'Manage repo', description: 'Manage your repo.', path: '/dashboard', noindex: true, heading: [{ label: 'Dashboard', link: '/dashboard' }] });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected can(to: RepoState): boolean {
    const l = this.repo();
    return !!l && canTransition(l.state, to, 'owner');
  }

  protected copy(text: string, what: string): void {
    this.snackBar.open(this.clipboard.copy(text) ? `${what} copied` : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }

  protected async createPushToken(): Promise<void> {
    await this.run(async () => {
      this.token.set(await firstValueFrom(this.api.writeToken(this.path())));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.path())));
    }, 'Could not create a push token.');
  }

  protected async saveDetails(input: RepoFormValue): Promise<void> {
    this.busy.set(true);
    this.detailsError.set(null);
    try {
      this.repo.set(await firstValueFrom(this.api.update(this.path(), input)));
      this.editing.set(false);
      this.snackBar.open('Details saved', undefined, { duration: 3000 });
    } catch (error) {
      const { message, fieldErrors } = describeRepoError(error);
      this.detailsError.set(message);
      this.detailsFieldErrors.set(fieldErrors);
    } finally {
      this.busy.set(false);
    }
  }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > SCREENSHOT_LIMITS.maxBytes) {
      this.snackBar.open(`Screenshots can be at most ${this.maxShotMb} MB.`, 'OK', { duration: 5000 });
      return;
    }
    this.busy.set(true);
    try {
      const shot = await firstValueFrom(this.api.uploadScreenshot(this.path(), file));
      this.screenshots.update((list) => [...list, shot]);
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null)?.error : undefined;
      const messages: Record<string, string> = {
        unsupported_image: 'Use a PNG, JPEG or WebP image.',
        too_large: `Screenshots can be at most ${this.maxShotMb} MB.`,
        too_many: `An app can have at most ${SCREENSHOT_LIMITS.maxCount} screenshots.`,
      };
      this.snackBar.open(messages[code ?? ''] ?? 'Upload failed. Please try again.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteScreenshot(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.deleteScreenshot(this.path(), id));
      this.screenshots.update((list) => list.filter((s) => s.id !== id));
    }, 'Could not delete the screenshot.');
  }

  protected async revoke(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.revokeToken(this.path(), id));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.path())));
      if (this.token()) this.token.set(null);
    }, 'Could not revoke the token.');
  }

  protected async revokeAll(): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: 'Revoke all tokens?', message: 'Every push and clone token for this repository stops working right away. Use this if a token may have leaked.', confirm: 'Revoke all' },
        })
        .afterClosed(),
    );
    if (!confirmed) return;
    await this.run(async () => {
      const { revoked } = await firstValueFrom(this.api.revokeAllTokens(this.path()));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.path())));
      this.token.set(null);
      this.snackBar.open(`${revoked} ${revoked === 1 ? 'token' : 'tokens'} revoked`, undefined, { duration: 3000 });
    }, 'Could not revoke the tokens.');
  }

  protected async submitVersion(formDirective: FormGroupDirective): Promise<void> {
    this.submitForm.markAllAsTouched();
    if (this.submitForm.invalid) return;
    this.submitError.set(null);
    this.submitIssues.set([]);
    const { tag, releaseNotes } = this.submitForm.getRawValue();
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.transition(this.path(), { to: 'submitted', tag: tag.trim(), releaseNotes }));
      // resetForm also clears the submitted state, so the empty field is not shown as an error.
      formDirective.resetForm();
      this.snackBar.open(`Submitted ${tag} for review`, undefined, { duration: 4000 });
      await this.load();
    } catch (error) {
      this.explainSubmitError(error, tag);
    } finally {
      this.busy.set(false);
    }
  }

  protected async change(to: Exclude<RepoState, 'submitted' | 'published'>): Promise<void> {
    if (to === 'removed') {
      const confirmed = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: { title: 'Delete repo?', message: 'It leaves the marketplace for good, and every token for it is revoked. This cannot be undone.', confirm: 'Delete' },
          })
          .afterClosed(),
      );
      if (!confirmed) return;
    }
    const request = { to } as TransitionRequest;
    await this.run(async () => {
      await firstValueFrom(this.api.transition(this.path(), request));
      await this.load();
    }, 'That change could not be made. Reload and try again.');
  }

  private async load(): Promise<void> {
    try {
      const repo = await firstValueFrom(this.api.repo(this.path()));
      this.repo.set(repo);
      this.seo.setHeading([{ label: repo.owner.handle, link: `/${repo.owner.handle}` }, { label: repo.slug }]);
      const [git, events, screenshots, tokens] = await firstValueFrom(
        forkJoin([this.api.git(this.path()), this.api.events(this.path()), this.api.screenshots(this.path()), this.api.tokens(this.path())]),
      );
      this.remote.set(git.remote);
      this.events.set(events);
      this.screenshots.set(screenshots);
      this.tokens.set(tokens);
    } catch {
      this.loadError.set(true);
    }
  }

  private async run(action: () => Promise<void>, failure: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch {
      this.snackBar.open(failure, 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  private explainSubmitError(error: unknown, tag: string): void {
    const body = error instanceof HttpErrorResponse ? (error.error as { error?: string; issues?: unknown[]; errors?: unknown[] } | null) : null;
    switch (body?.error) {
      case 'tag_not_found':
        this.submitError.set(`Tag ${tag} is not in the repository. Push it first: git push appmarket ${tag}`);
        return;
      case 'runtime_mismatch':
        this.submitError.set(`Version ${tag} does not look like this app's runtime:`);
        this.submitIssues.set(body.issues as string[]);
        return;
      case 'contract_failed':
        this.submitError.set(`Version ${tag} does not meet the template rules:`);
        this.submitIssues.set((body.errors as { file: string; message: string }[]).map((e) => `${e.file}: ${e.message}`));
        return;
      case 'invalid':
        this.submitError.set('Check the tag name and release notes.');
        return;
      case 'transition_not_allowed':
      case 'conflict':
        this.submitError.set('The app changed. Reload and try again.');
        return;
      default:
        this.submitError.set('Could not submit. Please try again.');
    }
  }
}
