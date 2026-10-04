import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RELEASE_PLATFORMS, type Release } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Catalog } from '../../api/catalog';
import { ConfirmDialog, type ConfirmDialogData } from '../confirm-dialog/confirm-dialog';
import { fileSize } from '../file-size';

/** PRD R14: downloads for the published version; each click gets a fresh signed link. */
@Component({
  selector: 'app-downloads',
  imports: [MatButtonModule, MatIconModule, MatListModule, MatTooltipModule],
  templateUrl: './downloads.html',
  styleUrl: './downloads.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Downloads {
  readonly releases = input.required<Release[]>();
  /** #33: the developer's Android verification declaration; APKs download only with it. */
  readonly android = input<{ package: string } | null>(null);
  private readonly dialog = inject(MatDialog);

  private readonly catalog = inject(Catalog);
  protected readonly platforms = RELEASE_PLATFORMS;
  protected readonly size = fileSize;
  protected readonly pending = signal<string | null>(null);
  protected readonly hasApk = computed(() => this.releases().some((r) => r.platform === 'android'));
  protected readonly error = signal<string | null>(null);

  protected async download(release: Release): Promise<void> {
    if (release.platform === 'android') {
      // #33: installing an APK outside an app store needs informed consent.
      const ok = await firstValueFrom(
        this.dialog
          .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
            data: {
              title: 'Install an Android app from outside Google Play?',
              message: `You are about to download ${release.filename} (${this.android()?.package}). Android asks you to allow installs from your browser ("Install unknown apps"). Only install apps from developers you trust; compare the SHA-256 shown here with the downloaded file. The developer says the app is registered with Android developer verification; on certified devices in some countries, Android blocks apps whose developer is not verified.`,
              confirm: 'Download APK',
            },
            width: '32rem',
          })
          .afterClosed(),
      );
      if (!ok) return;
    }
    this.pending.set(release.id);
    this.error.set(null);
    try {
      const link = await firstValueFrom(this.catalog.downloadLink(release.id));
      window.location.assign(link.url);
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 429 ? 'Too many downloads in a short time. Try again in a minute.' : 'Download failed. Please try again.');
    } finally {
      this.pending.set(null);
    }
  }
}
