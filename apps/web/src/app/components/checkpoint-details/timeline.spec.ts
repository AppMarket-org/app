import { builtWith, summaryLine, toolGroups, toolIcon } from './timeline';

describe('build history summary', () => {
  it('writes the PRD summary and badge', () => {
    const summary = { total: 38, harnesses: { 'claude-code': 31, none: 7 } };
    expect(summaryLine(summary)).toBe('38 commits, 31 by Claude Code, 7 manual');
    expect(builtWith(summary)).toBe('Built with Claude Code');
    expect(builtWith({ total: 5, harnesses: { codex: 1, 'claude-code': 3, cursor: 1 } })).toBe('Built with Claude Code, Codex and Cursor');
    expect(builtWith({ total: 2, harnesses: { none: 2 } })).toBe('');
  });
});

describe('toolGroups', () => {
  it('sums the calls up per tool, with the files or commands they were on, most used first', () => {
    const t = (name: string, args_summary: string, outcome: 'ok' | 'error' = 'ok') => ({ name, args_summary, outcome, ts: '' });
    const groups = toolGroups([
      t('Bash', 'ls && cat public/index.html && cat public/game.js && cat public/style.css && cat README.md'),
      t('Grep', 'theme|toggle'),
      t('Edit', 'public/index.html'),
      t('Edit', 'public/index.html'),
      t('Edit', 'README.md'),
      t('Edit', 'public/game.js'),
      t('Edit', 'public/game.js'),
      t('Edit', 'public/game.js'),
      t('Edit', 'public/style.css'),
      t('Edit', 'test/a.test.mjs'),
      t('Edit', 'test/b.test.mjs', 'error'),
      t('Bash', 'npm test', 'error'),
    ]);
    expect(groups.map((g) => [g.name, g.calls, g.errors])).toEqual([
      ['Bash', 2, 1],
      ['Grep', 1, 0],
      ['Edit', 9, 1],
    ]);
    expect(groups[2]!.targets).toEqual([
      { label: 'game.js', count: 3 },
      { label: 'index.html', count: 2 },
      { label: 'README.md', count: 1 },
      { label: 'style.css', count: 1 },
    ]);
    expect(groups[2]!.more).toBe(2);
    expect(groups[0]!.targets[0]!.label).toBe('ls && cat public/index.html && cat public/game.…');
    expect(toolIcon('Edit')).toBe('edit');
    expect(toolIcon('Bash')).toBe('terminal');
    expect(toolIcon('mcp__appmarket__memory_recall')).toBe('extension');
  });
});
