import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RELEASE_PLATFORMS, type Release } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { Catalog } from '../../api/catalog';
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

  private readonly catalog = inject(Catalog);
  protected readonly platforms = RELEASE_PLATFORMS;
  protected readonly size = fileSize;
  protected readonly pending = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async download(release: Release): Promise<void> {
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
