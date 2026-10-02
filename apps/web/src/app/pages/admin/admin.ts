import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { REPORT_REASONS, type Listing, type ListingReport, type TransitionRequest } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Admin as AdminApi } from '../../api/admin';
import { DeployManifest } from '../../components/deploy-manifest/deploy-manifest';
import { Markdown } from '../../components/markdown/markdown';
import { NoteDialog, type NoteDialogData } from '../../components/note-dialog/note-dialog';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';

/** PRD R18: moderation. Review submissions, take listings down, handle reports. Admin role only. */
@Component({
  selector: 'app-admin',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatExpansionModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTabsModule,
    DeployManifest,
    Markdown,
    RuntimeBadge,
  ],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly api = inject(AdminApi);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly reasons = REPORT_REASONS;
  protected readonly queue = signal<Listing[] | null>(null);
  protected readonly published = signal<Listing[] | null>(null);
  protected readonly reports = signal<ListingReport[] | null>(null);
  protected readonly reportStatus = signal<'open' | 'resolved'>('open');
  protected readonly readmes = signal<Record<string, string | null>>({});
  protected readonly busy = signal(false);

  constructor() {
    inject(Seo).set({ title: 'Moderation', description: 'Moderation.', path: '/admin', noindex: true });
  }

  ngOnInit(): void {
    void this.reload();
  }

  protected async loadReadme(slug: string): Promise<void> {
    if (slug in this.readmes()) return;
    const markdown = await firstValueFrom(this.api.readme(slug)).catch(() => null);
    this.readmes.update((all) => ({ ...all, [slug]: markdown }));
  }

  protected async approve(listing: Listing): Promise<void> {
    const note = await this.ask({ title: `Publish ${listing.name} ${listing.submittedTag}?`, message: 'It becomes public, pinned to the reviewed commit.', label: 'Note for the owner (optional)', confirm: 'Publish', required: false });
    if (note !== undefined) await this.decide(listing, { to: 'published', note: note || undefined }, `${listing.name} published`);
  }

  protected async requestChanges(listing: Listing): Promise<void> {
    const note = await this.ask({ title: `Request changes to ${listing.name}?`, message: 'It goes back to draft. The owner sees your note in its history.', label: 'What should change?', confirm: 'Request changes', required: true });
    if (note) await this.decide(listing, { to: 'draft', note }, 'Changes requested');
  }

  protected async takeDown(listing: Listing, to: 'unpublished' | 'removed'): Promise<boolean> {
    const removing = to === 'removed';
    const note = await this.ask({
      title: `${removing ? 'Remove' : 'Unpublish'} ${listing.name}?`,
      message: removing ? 'It leaves the catalog for good and every repository token is revoked. This cannot be undone.' : 'It is hidden from the catalog until the owner resubmits and it is approved again.',
      label: 'Reason (shown to the owner)',
      confirm: removing ? 'Remove' : 'Unpublish',
      required: true,
      danger: true,
    });
    if (!note) return false;
    return this.decide(listing, { to, note }, `${listing.name} ${removing ? 'removed' : 'unpublished'}`);
  }

  protected async dismiss(report: ListingReport): Promise<void> {
    const note = await this.ask({ title: 'Dismiss report?', message: 'Use this when the listing does not break the rules.', label: 'Note (optional)', confirm: 'Dismiss', required: false });
    if (note === undefined) return;
    await this.run(async () => {
      await firstValueFrom(this.api.resolveReport(report.id, 'dismissed', note || undefined));
      this.snackBar.open('Report dismissed', undefined, { duration: 3000 });
    });
  }

  protected async takeDownReported(report: ListingReport): Promise<void> {
    const listing = (this.published() ?? []).find((l) => l.slug === report.listing.slug);
    if (!listing) {
      this.snackBar.open('Only published listings can be taken down from here.', 'OK', { duration: 5000 });
      return;
    }
    if (await this.takeDown(listing, 'unpublished')) {
      await this.run(async () => {
        await firstValueFrom(this.api.resolveReport(report.id, 'taken_down'));
      });
    }
  }

  protected async showReports(status: 'open' | 'resolved'): Promise<void> {
    this.reportStatus.set(status);
    this.reports.set(null);
    this.reports.set(await firstValueFrom(this.api.reports(status)).catch(() => []));
  }

  private async decide(listing: Listing, request: TransitionRequest, done: string): Promise<boolean> {
    return this.run(async () => {
      await firstValueFrom(this.api.transition(listing.slug, request));
      this.snackBar.open(done, undefined, { duration: 3000 });
    });
  }

  private ask(data: NoteDialogData): Promise<string | undefined> {
    return firstValueFrom(this.dialog.open<NoteDialog, NoteDialogData, string>(NoteDialog, { data, width: '32rem' }).afterClosed());
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    try {
      await action();
      await this.reload();
      return true;
    } catch {
      this.snackBar.open('That did not work. Reload and try again.', 'OK', { duration: 6000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    const [queue, published, reports] = await Promise.all([
      firstValueFrom(this.api.listings('submitted')).catch(() => []),
      firstValueFrom(this.api.listings('published')).catch(() => []),
      firstValueFrom(this.api.reports(this.reportStatus())).catch(() => []),
    ]);
    this.queue.set(queue);
    this.published.set(published);
    this.reports.set(reports);
  }
}
