import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink } from '@angular/router';
import type { CommitEntry } from '@appmarket/shared';
import { HARNESS_LABELS } from '../checkpoint-details/timeline';

/**
 * Commits with the prompts behind them: a repo's history and a profile's activity. Prompts show
 * where the viewer may see the commit's checkpoint; agent commits without visible prompts still
 * say which agent and model made them.
 */
@Component({
  selector: 'app-commit-list',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatListModule, RouterLink],
  templateUrl: './commit-list.html',
  styleUrl: './commit-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitList {
  readonly commits = input.required<CommitEntry[]>();
  /** `owner/slug`, for links to the code at each commit. */
  readonly repo = input.required<string>();
  protected readonly harnesses = HARNESS_LABELS;
}
