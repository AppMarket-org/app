import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ContributionCalendar } from '@appmarket/shared';
import { monthLabels, monthTotals, tooltip, weeks } from './calendar';

/** #144: GitHub-style contribution calendar: 53 weeks × 7 days, five levels from the theme. */
@Component({
  selector: 'app-contribution-graph',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatListModule, MatSelectModule, MatTooltipModule, RouterLink],
  templateUrl: './contribution-graph.html',
  styleUrl: './contribution-graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContributionGraph {
  readonly calendar = input.required<ContributionCalendar>();
  /** null: the last 12 months. */
  readonly year = input<number | null>(null);
  readonly yearChange = output<number | null>();

  protected readonly weeks = computed(() => weeks(this.calendar()));
  protected readonly months = computed(() => monthLabels(this.weeks()));
  protected readonly totals = computed(() => monthTotals(this.calendar()));
  protected readonly years = computed(() => {
    const current = new Date().getUTCFullYear();
    return [...new Set([current, ...this.calendar().years])].sort((a, b) => b - a);
  });
  protected readonly heading = computed(() => {
    const n = this.calendar().total;
    return `${n.toLocaleString('en-US')} contribution${n === 1 ? '' : 's'} ${this.year() ? `in ${this.year()}` : 'in the last year'}`;
  });
  protected readonly tooltip = tooltip;
  protected readonly weekdays = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  protected readonly levels = [0, 1, 2, 3, 4];
}
