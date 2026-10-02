import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, type FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { SCREENSHOT_LIMITS, canTransition, type Listing, type ListingEvent, type ListingInput, type ListingState, type RepoToken, type Screenshot, type TokenRecord, type TransitionRequest } from '@appmarket/shared';
import { firstValueFrom, forkJoin } from 'rxjs';
import { Developer } from '../../api/developer';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { ListingForm } from '../../components/listing-form/listing-form';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';
import { describeListingError } from '../listing-errors';
import { STATE_LABELS } from '../state-labels';

/** PRD R16/R12: one listing's repo, push token, version submission, lifecycle actions and history. */
@Component({
  selector: 'app-manage-listing',
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
    ListingForm,
    RuntimeBadge,
  ],
  templateUrl: './manage-listing.html',
  styleUrl: './manage-listing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageListing {
  readonly slug = input.required<string>();

  private readonly api = inject(Developer);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);

  protected readonly states = STATE_LABELS;
  protected readonly listing = signal<Listing | null>(null);
  protected readonly remote = signal<string | null>(null);
  protected readonly events = signal<ListingEvent[]>([]);
  protected readonly loadError = signal(false);
  protected readonly token = signal<RepoToken | null>(null);
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
    inject(Seo).set({ title: 'Manage listing', description: 'Manage your listing.', path: '/dashboard', noindex: true });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected can(to: ListingState): boolean {
    const l = this.listing();
    return !!l && canTransition(l.state, to, 'owner');
  }

  protected copy(text: string, what: string): void {
    this.snackBar.open(this.clipboard.copy(text) ? `${what} copied` : 'Copy failed; select the text instead', undefined, { duration: 2500 });
  }

  protected async createPushToken(): Promise<void> {
    await this.run(async () => {
      this.token.set(await firstValueFrom(this.api.writeToken(this.slug())));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.slug())));
    }, 'Could not create a push token.');
  }

  protected async saveDetails(input: ListingInput): Promise<void> {
    this.busy.set(true);
    this.detailsError.set(null);
    try {
      this.listing.set(await firstValueFrom(this.api.update(this.slug(), input)));
      this.editing.set(false);
      this.snackBar.open('Details saved', undefined, { duration: 3000 });
    } catch (error) {
      const { message, fieldErrors } = describeListingError(error);
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
      const shot = await firstValueFrom(this.api.uploadScreenshot(this.slug(), file));
      this.screenshots.update((list) => [...list, shot]);
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null)?.error : undefined;
      const messages: Record<string, string> = {
        unsupported_image: 'Use a PNG, JPEG or WebP image.',
        too_large: `Screenshots can be at most ${this.maxShotMb} MB.`,
        too_many: `A listing can have at most ${SCREENSHOT_LIMITS.maxCount} screenshots.`,
      };
      this.snackBar.open(messages[code ?? ''] ?? 'Upload failed. Please try again.', 'OK', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteScreenshot(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.deleteScreenshot(this.slug(), id));
      this.screenshots.update((list) => list.filter((s) => s.id !== id));
    }, 'Could not delete the screenshot.');
  }

  protected async revoke(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.revokeToken(this.slug(), id));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.slug())));
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
      const { revoked } = await firstValueFrom(this.api.revokeAllTokens(this.slug()));
      this.tokens.set(await firstValueFrom(this.api.tokens(this.slug())));
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
      await firstValueFrom(this.api.transition(this.slug(), { to: 'submitted', tag: tag.trim(), releaseNotes }));
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

  protected async change(to: Exclude<ListingState, 'submitted' | 'published'>): Promise<void> {
    if (to === 'removed') {
      const confirmed = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: { title: 'Remove listing?', message: 'It leaves the catalog for good, and every token for its repository is revoked. This cannot be undone.', confirm: 'Remove' },
          })
          .afterClosed(),
      );
      if (!confirmed) return;
    }
    const request = { to } as TransitionRequest;
    await this.run(async () => {
      await firstValueFrom(this.api.transition(this.slug(), request));
      await this.load();
    }, 'That change could not be made. Reload and try again.');
  }

  private async load(): Promise<void> {
    try {
      const listing = await firstValueFrom(this.api.listing(this.slug()));
      this.listing.set(listing);
      const [repo, events, screenshots, tokens] = await firstValueFrom(
        forkJoin([this.api.repo(this.slug()), this.api.events(this.slug()), this.api.screenshots(this.slug()), this.api.tokens(this.slug())]),
      );
      this.remote.set(repo.remote);
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
    const body = error instanceof HttpErrorResponse ? (error.error as { error?: string; issues?: unknown[] } | null) : null;
    switch (body?.error) {
      case 'tag_not_found':
        this.submitError.set(`Tag ${tag} is not in the repository. Push it first: git push appmarket ${tag}`);
        return;
      case 'runtime_mismatch':
        this.submitError.set(`Version ${tag} does not look like this listing's runtime:`);
        this.submitIssues.set(body.issues as string[]);
        return;
      case 'invalid':
        this.submitError.set('Check the tag name and release notes.');
        return;
      case 'transition_not_allowed':
      case 'conflict':
        this.submitError.set('The listing changed. Reload and try again.');
        return;
      default:
        this.submitError.set('Could not submit. Please try again.');
    }
  }
}
