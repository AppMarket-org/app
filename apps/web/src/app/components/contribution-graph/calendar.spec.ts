import { monthLabels, monthTotals, tooltip, weeks } from './calendar';

const calendar = { from: '2026-01-01', to: '2026-01-20', total: 13, years: [2026], days: { '2026-01-01': 1, '2026-01-05': 4, '2026-01-20': 8 } };

describe('contribution calendar', () => {
  it('lays out Sunday-first weeks, marks days outside the range, and scales levels to the busiest day', () => {
    const w = weeks(calendar);
    expect(w).toHaveLength(4); // weeks starting Dec 28, Jan 4, Jan 11, Jan 18
    expect(w[0]![0]).toMatchObject({ date: '2025-12-28', outside: true });
    expect(w[0]![4]).toMatchObject({ date: '2026-01-01', count: 1, level: 1, outside: false });
    expect(w[1]![1]).toMatchObject({ date: '2026-01-05', count: 4, level: 2 });
    expect(w[3]![2]).toMatchObject({ date: '2026-01-20', count: 8, level: 4 });
    expect(w[3]![3]!.outside).toBe(true);
  });

  it('labels months, totals them for screen readers, and words tooltips', () => {
    const many = { ...calendar, from: '2025-12-01', to: '2026-02-28' };
    expect(monthLabels(weeks(many)).map((m) => m.label)).toEqual(['Dec', 'Jan', 'Feb']);
    expect(monthTotals(calendar)).toEqual([{ month: 'January 2026', count: 13 }]);
    expect(tooltip({ date: '2026-10-03', count: 4, level: 2, outside: false })).toBe('4 contributions on Oct 3, 2026');
    expect(tooltip({ date: '2026-10-03', count: 1, level: 4, outside: false })).toBe('1 contribution on Oct 3, 2026');
    expect(tooltip({ date: '2026-10-03', count: 0, level: 0, outside: false })).toBe('No contributions on Oct 3, 2026');
  });
});
