import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Checkpoint } from '@appmarket/shared';
import { CheckpointsPage } from './checkpoints';
import { effortLine, groupBySession } from './timeline';

function checkpoint(n: number, extra: Partial<Checkpoint> = {}): Checkpoint {
  return {
    schema: 'appmarket.checkpoint/1',
    commit: String(n).repeat(40).slice(0, 40),
    parents: [],
    branch: 'main',
    author: { name: 'Dev', email: 'dev@example.test' },
    harness: 'claude-code',
    harness_version: '2.1.0',
    session_id: 's1',
    model: 'claude-opus-5-5',
    effort: { raw: 'high', level: 'high' },
    effort_metrics: { turns: 3, wall_clock_s: 840, tool_calls: 41, retries: 0, reasoning_tokens: null },
    prompts: [{ ts: '2026-10-03T10:00:00Z', text: `Prompt ${n}` }],
    assistant_summary: '',
    tools: [],
    usage: { input_tokens: 200_000, output_tokens: 12_000, cost_usd: null },
    files: [{ path: 'src/a.ts', added: 1, removed: 0 }],
    redactions: 0,
    source: 'harness',
    created_at: '2026-10-03T10:14:00Z',
    repo: 'dev/app',
    state: 'pending',
    visibility: 'private',
    device: 'laptop',
    received_at: `2026-10-03T10:1${n}:00Z`,
    ...extra,
  };
}

describe('timeline', () => {
  it('writes the PRD effort line', () => {
    expect(effortLine(checkpoint(1))).toBe('3 prompts, 14 min, 41 tool calls, 212k tokens');
    expect(effortLine(checkpoint(1, { harness: 'none' }))).toBe('');
  });

  it('groups consecutive checkpoints of one session', () => {
    const groups = groupBySession([checkpoint(3), checkpoint(2), checkpoint(1, { harness: 'none', session_id: '' }), checkpoint(0)]);
    expect(groups.map((g) => [g.session, g.items.length])).toEqual([['s1', 2], ['', 1], ['s1', 1]]);
  });
});

describe('CheckpointsPage', () => {
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(CheckpointsPage);
    fixture.componentRef.setInput('owner', 'dev');
    fixture.componentRef.setInput('slug', 'app');
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/repos/dev/app').flush({ name: 'App', fullName: 'dev/app', checkpointVisibility: 'private' });
    http.expectOne((r) => r.url === '/api/repos/dev/app/checkpoints').flush({ items: [checkpoint(2), checkpoint(1, { state: 'attached' })], next: null });
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.textContent).toContain('Checkpoints');
      expect(el.querySelector('mat-expansion-panel')).not.toBeNull();
    });
    return { fixture, http, el };
  }

  it('shows the session, states and prompt previews', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('Claude Code · claude-opus-5-5');
    expect(el.textContent).toContain('2 commits, 2 by an agent, 0 manual');
    expect(el.textContent).toContain('Prompt 2');
    expect(el.textContent).toContain('pending');
    expect(el.textContent).toContain('attached');
  });

  it('changes the default visibility for new checkpoints', async () => {
    const { fixture, http } = await setup();
    const done = (fixture.componentInstance as unknown as { setDefault(v: string): Promise<void> }).setDefault('listing');
    const req = http.expectOne('/api/repos/dev/app/checkpoint-settings');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ visibility: 'listing' });
    req.flush({ visibility: 'listing' });
    await done;
  });
});
