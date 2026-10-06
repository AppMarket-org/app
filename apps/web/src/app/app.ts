import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, REQUEST, TransferState, computed, inject, makeStateKey, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, NavigationError, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Auth } from './auth/auth';
import { Seo } from './seo/seo';

import { Avatar } from './components/avatar/avatar';
import { RepoPicker } from './components/repo-picker/repo-picker';

const SESSION_HINT = makeStateKey<boolean>('session-pending');

@Component({
  selector: 'app-root',
  imports: [
    Avatar,
    RouterOutlet,
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly seo = inject(Seo);
  protected readonly workspace = computed(
    () => !!this.auth.user() && this.seo.heading().length > 0,
  );
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly routeReady = signal(this.router.navigated);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly transfer = inject(TransferState);
  // A cookie is only a display hint; the session endpoint still decides authentication.
  private readonly sessionHint = this.transfer.get(SESSION_HINT,
    /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(this.request?.headers.get('cookie') ?? ''));
  protected readonly initializing = computed(() => this.browser
    ? this.auth.user() === undefined || !this.routeReady()
    : this.sessionHint);

  constructor() {
    if (!this.browser) this.transfer.set(SESSION_HINT, this.sessionHint);
    else this.transfer.remove(SESSION_HINT);
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd || event instanceof NavigationError) this.routeReady.set(true);
    });
    void this.auth.load();
  }

  private readonly dialog = inject(MatDialog);

  /** New issue: in the repo being viewed (when it is yours), otherwise pick one. */
  protected newIssue(): void {
    const segments = this.router.parseUrl(this.router.url).root.children['primary']?.segments.map((s) => s.path) ?? [];
    const [owner, slug] = segments[0] === 'dashboard' && segments[1] === 'repos' ? segments.slice(2, 4) : segments.slice(0, 2);
    const reserved = ['dashboard', 'settings', 'search', 'category', 'legal', 'admin', 'login', 'device', 'email'];
    const mine = owner && slug && !reserved.includes(owner) && (this.auth.owner()?.handle === owner || this.auth.orgs().some((m) => m.org.handle === owner));
    if (mine) {
      void this.router.navigate(['/', owner, slug, 'issues', 'new']);
      return;
    }
    this.dialog
      .open(RepoPicker, { data: { title: 'New issue in…' }, width: '32rem', maxWidth: 'calc(100vw - 2rem)' })
      .afterClosed()
      .subscribe((path?: string) => path && void this.router.navigateByUrl(`/${path}/issues/new`));
  }

  protected search(event: Event, query: string): void {
    event.preventDefault();
    const q = query.trim();
    void this.router.navigate(['/search'], { queryParams: q ? { q } : {} });
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
