import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { languageShares } from '@appmarket/shared';

/** #170: GitHub-style Languages bar and legend for a repo's published version. */
@Component({
  selector: 'app-language-bar',
  imports: [MatTooltipModule],
  templateUrl: './language-bar.html',
  styleUrl: './language-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageBar {
  readonly languages = input.required<Record<string, number> | null>();
  protected readonly shares = computed(() => languageShares(this.languages()));
  protected readonly summary = computed(() => this.shares().map((s) => `${s.name} ${s.percent}%`).join(', '));
}
