import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CommitEntry } from '@appmarket/shared';
import { CommitList } from './commit-list';

const commits: CommitEntry[] = [
  { sha: 'a'.repeat(40), title: 'Daily board', author: { name: 'Chris' }, date: '2026-10-06T15:20:00Z', checkpoint: { harness: 'claude-code', model: 'claude-opus-5-5', visibility: 'listing', prompts: ['Add a daily board'], promptCount: 3 } },
  { sha: 'b'.repeat(40), title: 'Manual fix', author: { name: 'Chris' }, date: '2026-10-05T15:20:00Z', checkpoint: null },
];

describe('CommitList', () => {
  it('shows each commit with a link to its code, the agent and model, and the prompts behind it', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CommitList);
    fixture.componentRef.setInput('commits', commits);
    fixture.componentRef.setInput('repo', 'cport1/bombfind');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const items = [...el.querySelectorAll('.commit')];
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('.title')?.textContent).toBe('Daily board');
    expect(items[0]!.querySelector('.meta')?.textContent).toContain('Claude Code · claude-opus-5-5');
    expect(items[0]!.querySelector('.prompt')?.textContent).toContain('Add a daily board');
    expect(items[0]!.querySelector('.more')?.textContent).toContain('and 2 more prompts');
    expect(items[0]!.querySelector('a.sha')?.getAttribute('href')).toBe(`/cport1/bombfind/code?ref=${'a'.repeat(40)}`);
    expect(items[1]!.querySelector('.prompt')).toBeNull();
  });
});
