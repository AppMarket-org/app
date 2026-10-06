import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ISSUE_TYPE_LABELS, type IssueType } from '@appmarket/shared';

/** An issue's type: a colored ring and its name (Bug, Feature, Task). */
@Component({
  selector: 'app-issue-type',
  template: `<span class="ring" [class]="type()" aria-hidden="true"></span>{{ label() }}`,
  styleUrl: './issue-type.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueTypeBadge {
  readonly type = input.required<IssueType>();
  protected readonly label = computed(() => ISSUE_TYPE_LABELS[this.type()].label);
}
