import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RUNTIMES, type Runtime } from '@appmarket/shared';

const TIER_LABELS = { supported: 'Supported', limited: 'Supported with limits', advanced: 'Advanced' } as const;

/** PRD R26: runtime and support tier as a Material chip; the note explains it on hover or focus. Place inside a mat-chip-set. */
@Component({
  selector: 'app-runtime-badge',
  imports: [MatChipsModule, MatTooltipModule],
  templateUrl: './runtime-badge.html',
  styleUrl: './runtime-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuntimeBadge {
  readonly runtime = input.required<Runtime>();
  protected readonly info = computed(() => RUNTIMES[this.runtime()]);
  protected readonly tierLabel = computed(() => TIER_LABELS[this.info().tier]);
}
