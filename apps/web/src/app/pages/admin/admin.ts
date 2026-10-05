import { HttpErrorResponse } from '@angular/common/http';
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
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { ChecksCard } from '../manage-repo/checks-card/checks-card';
import { Conformance } from '../../components/conformance/conformance';
import { REPORT_REASONS, type Repo, type RepoReport, type Sale, type TransitionRequest } from '@appmarket/shared';
import { HttpClient } from '@angular/common/http';
import { ConfirmDialog, type ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog';
import { firstValueFrom } from 'rxjs';
import { Admin as AdminApi } from '../../api/admin';
import { DeployManifest } from '../../components/deploy-manifest/deploy-manifest';
import { Markdown } from '../../components/markdown/markdown';
import { NoteDialog, type NoteDialogData } from '../../components/note-dialog/note-dialog';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { Seo } from '../../seo/seo';

/** PRD R18: moderation. Review submissions, take repos down, handle reports. Admin role only. */
@Component({
  selector: 'app-admin',
  imports: [
    ChecksCard,
    Conformance,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
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
  protected readonly queue = signal<Repo[] | null>(null);
  protected readonly published = signal<Repo[] | null>(null);
  protected readonly reports = signal<RepoReport[] | null>(null);
  protected readonly reportStatus = signal<'open' | 'resolved'>('open');
  protected readonly readmes = signal<Record<string, string | null>>({});
  protected readonly busy = signal(false);
  /** #69 */
  protected readonly impactKind = signal<'package' | 'rule'>('package');
  protected readonly impactTarget = signal('');
  protected readonly impactAffected = signal('');
  protected readonly impactTitle = signal('');
  protected readonly impactGuidance = signal('');
  protected readonly impacts = signal<{ id: string; kind: string; target: string; affected: string | null; title: string; open_repos: number; resolved_repos: number; closed_at: string | null }[] | null>(null);
  protected readonly impactRepos = signal<Record<string, { repo: string; state: string; detail: string | null; forked_from: string | null; resolved_at: string | null }[]>>({});
  /** #67 */
  protected readonly graphKind = signal<'packages' | 'bindings'>('packages');
  protected readonly graphQuery = signal('');
  protected readonly graphVersion = signal('');
  protected readonly graphResults = signal<{ repo: string; state: string; kind: string; detail: string | null; forkedFrom: string | null }[] | null>(null);
  /** #214: null until loaded. */
  protected readonly sales = signal<Sale[] | null>(null);
  protected readonly money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  private readonly http = inject(HttpClient);

  constructor() {
    inject(Seo).set({ title: 'Moderation', description: 'Moderation.', path: '/admin', noindex: true });
  }

  ngOnInit(): void {
    void this.reload();
  }

  protected async loadReadme(path: string): Promise<void> {
    if (path in this.readmes()) return;
    const markdown = await firstValueFrom(this.api.readme(path)).catch(() => null);
    this.readmes.update((all) => ({ ...all, [path]: markdown }));
  }

  protected async approve(repo: Repo): Promise<void> {
    const note = await this.ask({ title: `Publish ${repo.name} ${repo.submittedTag}?`, message: 'It becomes public, pinned to the reviewed commit.', label: 'Note for the owner (optional)', confirm: 'Publish', required: false });
    if (note !== undefined) await this.decide(repo, { to: 'published', note: note || undefined }, `${repo.name} published`);
  }

  protected async requestChanges(repo: Repo): Promise<void> {
    const note = await this.ask({ title: `Request changes to ${repo.name}?`, message: 'It goes back to draft. The owner sees your note in its history.', label: 'What should change?', confirm: 'Request changes', required: true });
    if (note) await this.decide(repo, { to: 'draft', note }, 'Changes requested');
  }

  protected async takeDown(repo: Repo, to: 'unpublished' | 'removed'): Promise<boolean> {
    const removing = to === 'removed';
    const note = await this.ask({
      title: `${removing ? 'Remove' : 'Unpublish'} ${repo.name}?`,
      message: removing ? 'It leaves the catalog for good and every repository token is revoked. This cannot be undone.' : 'It is hidden from the catalog until the owner resubmits and it is approved again.',
      label: 'Reason (shown to the owner)',
      confirm: removing ? 'Remove' : 'Unpublish',
      required: true,
      danger: true,
    });
    if (!note) return false;
    return this.decide(repo, { to, note }, `${repo.name} ${removing ? 'removed' : 'unpublished'}`);
  }

  protected async dismiss(report: RepoReport): Promise<void> {
    const note = await this.ask({ title: 'Dismiss report?', message: 'Use this when the app does not break the rules.', label: 'Note (optional)', confirm: 'Dismiss', required: false });
    if (note === undefined) return;
    await this.run(async () => {
      await firstValueFrom(this.api.resolveReport(report.id, 'dismissed', note || undefined));
      this.snackBar.open('Report dismissed', undefined, { duration: 3000 });
    });
  }

  protected async takeDownReported(report: RepoReport): Promise<void> {
    const repo = (this.published() ?? []).find((l) => l.fullName === report.repo.fullName);
    if (!repo) {
      this.snackBar.open('Only published apps can be taken down from here.', 'OK', { duration: 5000 });
      return;
    }
    if (await this.takeDown(repo, 'unpublished')) {
      await this.run(async () => {
        await firstValueFrom(this.api.resolveReport(report.id, 'taken_down'));
      });
    }
  }

  protected async loadImpacts(): Promise<void> {
    this.impacts.set((await firstValueFrom(this.http.get<{ items: never[] }>('/api/admin/impacts')).catch(() => ({ items: [] }))).items);
  }

  protected async fileImpact(): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(
        this.http.post<{ affected: number }>('/api/admin/impacts', { kind: this.impactKind(), target: this.impactTarget().trim(), affected: this.impactAffected().trim() || undefined, title: this.impactTitle().trim(), guidance: this.impactGuidance().trim() }),
      );
      this.snackBar.open(`Filed: ${r.affected} repo${r.affected === 1 ? '' : 's'} affected; their owners see a notice`, undefined, { duration: 5000 });
      this.impactTarget.set('');
      this.impactAffected.set('');
      this.impactTitle.set('');
      this.impactGuidance.set('');
      await this.loadImpacts();
    });
  }

  protected async showImpact(id: string): Promise<void> {
    const r = await firstValueFrom(this.http.get<{ repos: never[] }>(`/api/admin/impacts/${id}`)).catch(() => ({ repos: [] }));
    this.impactRepos.update((all) => ({ ...all, [id]: r.repos }));
  }

  protected async recheckImpact(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post(`/api/admin/impacts/${id}/recheck`, {}));
      await Promise.all([this.loadImpacts(), this.showImpact(id)]);
    });
  }

  protected async closeImpact(id: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post(`/api/admin/impacts/${id}/close`, {}));
      await this.loadImpacts();
    });
  }

  protected async searchGraph(): Promise<void> {
    const params: Record<string, string> = this.graphKind() === 'packages' ? { name: this.graphQuery().trim(), ...(this.graphVersion().trim() ? { version: this.graphVersion().trim() } : {}) } : { type: this.graphQuery().trim() };
    this.graphResults.set((await firstValueFrom(this.http.get<{ items: never[] }>(`/api/admin/graph/${this.graphKind()}`, { params })).catch(() => ({ items: [] }))).items);
  }

  protected async loadSales(): Promise<void> {
    this.sales.set((await firstValueFrom(this.http.get<{ items: Sale[] }>('/api/admin/purchases')).catch(() => ({ items: [] }))).items);
  }

  /** #214: full refund; the developer's share and appmarket's fee are reversed and the buyer loses the app. */
  protected async refund(s: Sale): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: { title: `Refund ${this.money(s.amountCents)} to ${s.buyer}?`, message: `${s.buyer} loses access to ${s.repo}. The developer's share and appmarket's fee are reversed. This cannot be undone.`, confirm: 'Refund' },
          width: '30rem',
        })
        .afterClosed(),
    );
    if (!ok) return;
    await this.run(async () => {
      await firstValueFrom(this.http.post(`/api/admin/purchases/${s.id}/refund`, {}));
      this.snackBar.open('Refunded', undefined, { duration: 3000 });
      await this.loadSales();
    });
  }

  protected async showReports(status: 'open' | 'resolved'): Promise<void> {
    this.reportStatus.set(status);
    this.reports.set(null);
    this.reports.set(await firstValueFrom(this.api.reports(status)).catch(() => []));
  }

  private async decide(repo: Repo, request: TransitionRequest, done: string): Promise<boolean> {
    return this.run(async () => {
      await firstValueFrom(this.api.transition(repo.fullName, request));
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
    } catch (error) {
      // #27: the API explains refusals such as failing checks; show that rather than a generic error.
      const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
      this.snackBar.open(message ?? 'That did not work. Reload and try again.', 'OK', { duration: 6000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    const [queue, published, reports] = await Promise.all([
      firstValueFrom(this.api.repos('submitted')).catch(() => []),
      firstValueFrom(this.api.repos('published')).catch(() => []),
      firstValueFrom(this.api.reports(this.reportStatus())).catch(() => []),
    ]);
    this.queue.set(queue);
    this.published.set(published);
    this.reports.set(reports);
  }
}
