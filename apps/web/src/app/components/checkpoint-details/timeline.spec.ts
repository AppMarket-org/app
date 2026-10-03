import { builtWith, summaryLine } from './timeline';

describe('build history summary', () => {
  it('writes the PRD summary and badge', () => {
    const summary = { total: 38, harnesses: { 'claude-code': 31, none: 7 } };
    expect(summaryLine(summary)).toBe('38 commits, 31 by Claude Code, 7 manual');
    expect(builtWith(summary)).toBe('Built with Claude Code');
    expect(builtWith({ total: 5, harnesses: { codex: 1, 'claude-code': 3, cursor: 1 } })).toBe('Built with Claude Code, Codex and Cursor');
    expect(builtWith({ total: 2, harnesses: { none: 2 } })).toBe('');
  });
});
