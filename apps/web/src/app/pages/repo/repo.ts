import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { CATEGORIES, TARGET_PLATFORMS, type CheckpointSummary, type Repo } from '@appmarket/shared';
import { CowbellButton } from '../../components/cowbell-button/cowbell-button';
import { DeployAction } from '../../components/deploy-action/deploy-action';
import { DeployManifest } from '../../components/deploy-manifest/deploy-manifest';
import { DomainGuide } from '../../components/domain-guide/domain-guide';
import { Downloads } from '../../components/downloads/downloads';
import { RepoMap } from '../../components/repo-map/repo-map';
import { ReportDialog } from '../../components/report-dialog/report-dialog';
import { GetCode } from '../../components/get-code/get-code';
import { Markdown } from '../../components/markdown/markdown';
import { RuntimeBadge } from '../../components/runtime-badge/runtime-badge';
import { builtWith, summaryLine } from '../../components/checkpoint-details/timeline';
import { LanguageBar } from '../../components/language-bar/language-bar';
import { ForkDialog, type ForkDialogData } from '../../components/fork-dialog/fork-dialog';
import { Auth } from '../../auth/auth';
import { InstallApp } from '../../components/install-app/install-app';
import { Seo } from '../../seo/seo';
import { firstValueFrom } from 'rxjs';
import type { RepoDetails } from './repo-resolver';

const PLATFORM_NAMES: Record<(typeof TARGET_PLATFORMS)[number], string> = {
  workers: 'Cloudflare Workers',
  pwa: 'Installable web app',
  android: 'Android',
  ios: 'iOS',
  download: 'Download',
};

@Component({
  selector: 'app-repo',
  imports: [InstallApp, LanguageBar, DatePipe, MatButtonModule, MatDialogModule, MatIconModule, MatSnackBarModule, MatCardModule, MatChipsModule, MatDividerModule, MatListModule, RouterLink, CowbellButton, DeployAction, DeployManifest, DomainGuide, Downloads, GetCode, Markdown, RepoMap, RuntimeBadge],
  templateUrl: './repo.html',
  styleUrl: './repo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoPage {
  /** From repoResolver; null when the repo does not exist or is not visible. */
  readonly details = input<RepoDetails | null>(null);

  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected async report(path: string, name: string): Promise<void> {
    const sent = await firstValueFrom(this.dialog.open<ReportDialog, { path: string; name: string }, boolean>(ReportDialog, { data: { path, name }, width: '36rem' }).afterClosed());
    if (sent) this.snackBar.open('Thanks. An admin will review your report.', 'OK', { duration: 5000 });
  }

  protected readonly platformName = (p: keyof typeof PLATFORM_NAMES) => PLATFORM_NAMES[p];
  protected readonly builtWith = builtWith;
  private readonly forkDialog = inject(MatDialog);
  private readonly forkRouter = inject(Router);
  private readonly forkAuth = inject(Auth);

  /** #26: copy this app into a repo of your own; sign in first if needed. */
  protected async useTemplate(repo: Repo): Promise<void> {
    if (!this.forkAuth.user()) {
      await this.forkRouter.navigate(['/login'], { queryParams: { next: `/${repo.fullName}` } });
      return;
    }
    const fork = await firstValueFrom(this.forkDialog.open<ForkDialog, ForkDialogData, Repo>(ForkDialog, { data: { repo }, width: '30rem', maxWidth: 'calc(100vw - 2rem)' }).afterClosed());
    if (fork) await this.forkRouter.navigate(['/dashboard/repos', fork.owner.handle, fork.slug]);
  }
  /** #137: "Built with Claude Code · 74% of commits with published prompts" (counts only). */
  protected badge(history: CheckpointSummary | null): string | null {
    if (!history?.total) return null;
    const agents = builtWith(history);
    const share = history.commits ? Math.round(((history.withPublishedPrompts ?? 0) / history.commits) * 100) : 0;
    return [agents, share ? `${share}% of commits with published prompts` : null].filter(Boolean).join(' · ') || null;
  }
  protected readonly summaryLine = summaryLine;
  protected readonly categoryName = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    const data = route.data['details'] as RepoDetails | null;
    const seo = inject(Seo);
    if (!data) {
      seo.set({ title: 'App not found', description: 'This app does not exist or is not published.', path: `/${route.paramMap.get('owner') ?? ''}/${route.paramMap.get('slug') ?? ''}`, noindex: true });
      return;
    }
    const app = data.repo;
    seo.set({
      title: app.name,
      description: app.summary,
      path: `/${app.fullName}`,
      heading: [{ label: app.owner.handle, link: `/${app.owner.handle}` }, { label: app.slug }],
      // Generated card; ?v= changes with the repo so social sites fetch a new one after edits.
      image: `/api/og/${app.fullName}.png?v=${Date.parse(app.updatedAt) || 0}`,
      noindex: app.state !== 'published',
      jsonLd: {
        '@type': 'SoftwareApplication',
        name: app.name,
        description: app.summary,
        applicationCategory: this.categoryName(app.category),
        operatingSystem: 'Web',
        softwareVersion: app.publishedTag ?? undefined,
        image: data.screenshots[0] ? `https://appmarket.org${data.screenshots[0].url}` : undefined,
        datePublished: data.versions.at(-1)?.publishedAt,
        dateModified: data.versions[0]?.publishedAt,
        license: app.license ?? undefined,
        screenshot: data.screenshots.map((s) => `https://appmarket.org${s.url}`),
        offers: { '@type': 'Offer', price: (app.priceCents / 100).toFixed(2), priceCurrency: 'USD' },
        author: { '@type': 'Person', name: app.owner.name },
      },
    });
  }
}
