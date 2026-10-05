import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DEPLOY_UNAVAILABLE, RUNTIMES, type Deployment, type Repo, deployAvailability } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Purchases } from '../../api/purchases';
import { Auth } from '../../auth/auth';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DeployDialog, type DeployDialogData } from '../deploy-dialog/deploy-dialog';

/**
 * PRD D6/D4: "Deploy to Cloudflare" on a repo page, for repos the pipeline can build; others
 * get a short note on how to use the app instead. Signed-out visitors sign in first; returning
 * from sign-in or from connecting Cloudflare (`?deploy=1`) reopens the dialog.
 */
@Component({
  selector: 'app-deploy-action',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, RouterLink],
  templateUrl: './deploy-action.html',
  styleUrl: './deploy-action.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeployAction {
  readonly repo = input.required<Repo>();
  /** The repo has downloadable releases (R13), shown above on the page. */
  readonly hasReleases = input(false);

  protected readonly auth = inject(Auth);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly purchases = inject(Purchases);
  private readonly snackBar = inject(MatSnackBar);
  /** #213: bought (or edits it); paid apps deploy only then. */
  protected readonly owned = computed(() => !!this.purchases.owned()[this.repo().fullName]);
  protected readonly price = computed(() => `$${(this.repo().priceCents / 100).toFixed(2)}`);
  protected readonly buying = signal(false);
  private readonly availability = computed(() => deployAvailability(this.repo(), this.owned()));
  /** #212: paid, published, not owned yet: offer to buy. */
  protected readonly forSale = computed(() => { const a = this.availability(); return !a.ok && a.reason === 'paid'; });
  protected readonly deployable = computed(() => this.availability().ok);
  /** Why there is no Deploy action, for published repos; null otherwise. */
  protected readonly guidance = computed(() => {
    const a = this.availability();
    if (a.ok || a.reason === 'not_published' || a.reason === 'paid') return null;
    const l = this.repo();
    if (a.reason === 'platform') return this.hasReleases() ? 'Download it from the Downloads section above, or get the code below.' : 'Get the code below to build and run it.';
    if (a.reason === 'runtime') return `One-click deploy is not available for ${RUNTIMES[l.runtime].name} apps yet. Get the code below and deploy it with Wrangler.`;
    return DEPLOY_UNAVAILABLE[a.reason];
  });
  protected readonly returnPath = computed(() => `/${this.repo().fullName}?deploy=1`);

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;
    const path = this.repo().fullName;
    if (this.repo().priceCents > 0 && (await this.auth.load())) {
      // #212: back from Stripe Checkout.
      const session = this.route.snapshot.queryParamMap.get('purchase');
      if (session) {
        void this.router.navigate([], { queryParams: { purchase: null }, queryParamsHandling: 'merge', replaceUrl: true });
        const ok = await this.purchases.confirm(path, session);
        this.snackBar.open(ok ? `You own ${this.repo().name}. Deploy it or download it any time.` : 'The payment is still processing; this page updates once it completes.', 'OK', { duration: 6000 });
      } else await this.purchases.load(path);
    }
    if (this.route.snapshot.queryParamMap.get('deploy') !== '1' || !this.deployable()) return;
    void this.router.navigate([], { queryParams: { deploy: null, connected: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (await this.auth.load()) await this.open();
  }

  protected async buy(): Promise<void> {
    this.buying.set(true);
    const error = await this.purchases.buy(this.repo().fullName);
    this.buying.set(false);
    if (error) this.snackBar.open(error, 'OK', { duration: 6000 });
  }

  protected async open(): Promise<void> {
    const l = this.repo();
    const data: DeployDialogData = { path: l.fullName, slug: l.slug, name: l.name, version: l.publishedTag ?? '', secrets: l.manifest?.secrets ?? [], container: l.runtime === 'container' };
    const deployment = await firstValueFrom(this.dialog.open<DeployDialog, DeployDialogData, Deployment>(DeployDialog, { data, width: '32rem', maxWidth: '95vw' }).afterClosed());
    if (deployment) await this.router.navigate(['/dashboard/deployments', deployment.id]);
  }
}
