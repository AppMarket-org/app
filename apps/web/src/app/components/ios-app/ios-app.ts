import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * #43 (M4): an iOS app's links. Apple distributes it: the App Store page, and a public TestFlight
 * invite for the beta. appmarket.org never builds, signs or hosts iOS apps.
 */
@Component({
  selector: 'app-ios-app',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './ios-app.html',
  styleUrl: './ios-app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IosApp {
  readonly name = input.required<string>();
  readonly appStoreUrl = input<string | null>(null);
  readonly testflightUrl = input<string | null>(null);
}
