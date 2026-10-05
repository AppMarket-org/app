import { describe, expect, it } from 'vitest';
import { anchorOf, diffRows } from './diff-view';

describe('diff rows (#259)', () => {
  it('numbers old and new lines and anchors comments to the right side', () => {
    const rows = diffRows([{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3, lines: [' a', '-b', '+B', ' c'] }]);
    expect(rows.map((r) => `${r.kind}:${r.oldLine ?? ''}:${r.newLine ?? ''}:${r.text}`)).toEqual(['hunk:::@@ -10,3 +10,3 @@', 'ctx:10:10:a', 'del:11::b', 'add::11:B', 'ctx:12:12:c']);
    expect(anchorOf(rows[2]!)).toEqual({ side: 'old', line: 11 });
    expect(anchorOf(rows[3]!)).toEqual({ side: 'new', line: 11 });
    expect(anchorOf(rows[0]!)).toBeNull();
  });
});
