import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import type { PwaCheck } from '@appmarket/shared';

/**
 * #32 (M1): try the app at its live URL and, for installable web apps (PWA), how to install it on
 * Android, iPhone and iPad, and desktop. The install happens from the app's own site.
 */
@Component({
  selector: 'app-install-app',
  imports: [MatButtonModule, MatExpansionModule, MatIconModule],
  templateUrl: './install-app.html',
  styleUrl: './install-app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallApp {
  readonly url = input.required<string>();
  readonly name = input.required<string>();
  readonly pwa = input<PwaCheck | null>(null);
}
