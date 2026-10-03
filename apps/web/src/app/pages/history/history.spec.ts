import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HistoryPage } from './history';

const checkpoint = {
  commit: 'a'.repeat(40),
  harness: 'claude-code',
  model: 'claude-opus-5-5',
  session_id: 's1',
  effort: { raw: 'high', level: 'high' },
  effort_metrics: { turns: 1, wall_clock_s: 60, tool_calls: 2, retries: 0, reasoning_tokens: null },
  prompts: [{ ts: '2026-10-03T10:00:00Z', text: 'Add a visit counter' }],
  files: [{ path: 'src/index.ts', added: 5, removed: 0 }],
  created_at: '2026-10-03T10:01:00Z',
  author: { name: 'Dev', email: '' },
};

function render(history: unknown) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { history }, paramMap: convertToParamMap({ owner: 'dev', slug: 'app' }) } } },
    ],
  });
  const fixture = TestBed.createComponent(HistoryPage);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('HistoryPage', () => {
  it('shows the summary, badge and published prompts', () => {
    const el = render({
      repo: { name: 'App', slug: 'app', fullName: 'dev/app', state: 'published', owner: { handle: 'dev' } },
      page: { items: [checkpoint], next: null, summary: { total: 3, harnesses: { 'claude-code': 1, none: 2 } } },
    });
    expect(el.textContent).toContain('Built with Claude Code.');
    expect(el.textContent).toContain('3 commits, 1 by Claude Code, 2 manual');
    expect(el.textContent).toContain('Add a visit counter');
  });

  it('says so when nothing is published', () => {
    const el = render({ repo: { name: 'App', slug: 'app', fullName: 'dev/app', state: 'published', owner: { handle: 'dev' } }, page: { items: [], next: null, summary: { total: 0, harnesses: {} } } });
    expect(el.textContent).toContain('has not published a build history');
  });

  it('renders not found without data', () => {
    expect(render(null).textContent).toContain('App not found');
  });
});
