import type { ContributionCalendar } from '@appmarket/shared';

export interface Cell {
  date: string;
  count: number;
  /** 0 (none) to 4 (most), relative to the busiest day shown. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Before `from` or after `to`: drawn empty, no tooltip. */
  outside: boolean;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Weeks (Sunday first) covering [from, to], like GitHub's calendar. */
export function weeks(calendar: ContributionCalendar): Cell[][] {
  const from = Date.parse(`${calendar.from}T00:00:00Z`);
  const to = Date.parse(`${calendar.to}T00:00:00Z`);
  const start = from - new Date(from).getUTCDay() * DAY;
  const max = Math.max(0, ...Object.values(calendar.days));
  const out: Cell[][] = [];
  for (let t = start; t <= to; t += 7 * DAY) {
    const week: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = t + d * DAY;
      const date = iso(day);
      const count = calendar.days[date] ?? 0;
      const level = count === 0 || max === 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4);
      week.push({ date, count, level, outside: day < from || day > to });
    }
    out.push(week);
  }
  return out;
}

/** Month labels: the column where each month's first full week starts. */
export function monthLabels(cells: Cell[][]): { column: number; label: string }[] {
  const labels: { column: number; label: string }[] = [];
  let last = '';
  cells.forEach((week, column) => {
    const first = week.find((c) => !c.outside);
    if (!first) return;
    const month = first.date.slice(0, 7);
    if (month !== last) {
      // Skip a label squeezed into the very last column(s).
      if (column < cells.length - 2) labels.push({ column, label: new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) });
      last = month;
    }
  });
  return labels;
}

/** Contributions per month, for the screen-reader summary. */
export function monthTotals(calendar: ContributionCalendar): { month: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const [day, n] of Object.entries(calendar.days)) totals.set(day.slice(0, 7), (totals.get(day.slice(0, 7)) ?? 0) + n);
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, count]) => ({ month: new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), count }));
}

export function tooltip(cell: Cell): string {
  const date = new Date(`${cell.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${cell.count === 0 ? 'No' : cell.count} contribution${cell.count === 1 ? '' : 's'} on ${date}`;
}
