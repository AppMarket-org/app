import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Deployment, Listing } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../auth/auth';
import { DeployDialog, type DeployDialogData } from '../deploy-dialog/deploy-dialog';

/**
 * PRD D6: "Deploy to Cloudflare" on a listing page. Signed-out visitors sign in first; returning
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
  readonly listing = input.required<Listing>();

  protected readonly auth = inject(Auth);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** D4: paid listings deploy after purchase (not built yet), so only free ones show the button. */
  protected readonly deployable = computed(() => {
    const l = this.listing();
    return l.state === 'published' && l.priceCents === 0 && !!l.manifest && l.platforms.includes('workers');
  });
  protected readonly returnPath = computed(() => `/apps/${this.listing().slug}?deploy=1`);

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser || this.route.snapshot.queryParamMap.get('deploy') !== '1' || !this.deployable()) return;
    void this.router.navigate([], { queryParams: { deploy: null, connected: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (await this.auth.load()) await this.open();
  }

  protected async open(): Promise<void> {
    const l = this.listing();
    const data: DeployDialogData = { slug: l.slug, name: l.name, version: l.publishedTag ?? '', secrets: l.manifest?.secrets ?? [] };
    const deployment = await firstValueFrom(this.dialog.open<DeployDialog, DeployDialogData, Deployment>(DeployDialog, { data, width: '32rem', maxWidth: '95vw' }).afterClosed());
    if (deployment) await this.router.navigate(['/dashboard/deployments', deployment.id]);
  }
}
