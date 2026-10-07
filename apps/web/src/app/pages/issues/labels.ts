import type { Issue, IssuePriority } from '@appmarket/shared';

export const PRIORITY_LABELS: Record<IssuePriority, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export const assigneeLabel = (issue: Pick<Issue, 'assignee'>): string =>
  !issue.assignee ? 'No one' : issue.assignee.kind === 'agents' ? 'Agents' : issue.assignee.name;

/** Open, closed as completed, or closed as not planned. */
export const stateIcon = (issue: Pick<Issue, 'state' | 'reason'>): string =>
  issue.state === 'open' ? 'confirmation_number' : issue.reason === 'not_planned' ? 'block' : 'check_circle';
