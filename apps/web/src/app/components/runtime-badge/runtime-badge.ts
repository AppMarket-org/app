import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RUNTIMES, type Runtime } from '@appmarket/shared';

const TIER_LABELS = { supported: 'Supported', limited: 'Supported with limits', advanced: 'Advanced' } as const;

/** PRD R26: runtime name with its support tier; the note explains it on hover or focus. */
@Component({
  selector: 'app-runtime-badge',
  imports: [MatTooltipModule],
  templateUrl: './runtime-badge.html',
  styleUrl: './runtime-badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuntimeBadge {
  readonly runtime = input.required<Runtime>();
  protected readonly info = computed(() => RUNTIMES[this.runtime()]);
  protected readonly tierLabel = computed(() => TIER_LABELS[this.info().tier]);
}
