import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';

/**
 * PRD D12: how a buyer puts a deployed Worker on their own domain (Phase 1, Deploy button path).
 * Phase 2 automates this through the buyer's Cloudflare connection (D9).
 */
@Component({
  selector: 'app-domain-guide',
  imports: [MatButtonModule, MatExpansionModule, MatIconModule],
  templateUrl: './domain-guide.html',
  styleUrl: './domain-guide.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainGuide {}
