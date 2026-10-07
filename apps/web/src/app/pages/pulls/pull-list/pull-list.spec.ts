import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PullRequest } from '@appmarket/shared';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PullsApi } from '../../../api/pulls';
import { Auth } from '../../../auth/auth';
import { PullListPage } from './pull-list';

const pull = (n: number, agent: string | null) =>
  ({ number: n, title: `Task ${n}`, body: '', state: 'open', author: 'chris portscheller', agent, source: { repo: 'cport1/counter', branch: `b${n}`, fork: false }, target: { repo: 'cport1/counter', branch: 'main' }, review: { decision: null }, updatedAt: '2026-10-07T10:00:00Z' }) as unknown as PullRequest;

describe('PullListPage', () => {
  it("names the agent on a task's pull request, and the person otherwise", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PullsApi, useValue: { list: vi.fn(() => of({ items: [pull(7, 'Claude Code'), pull(9, null)], counts: { open: 2 } })) } },
        { provide: Auth, useValue: { owner: signal(null), orgs: signal([]), user: signal(null) } },
      ],
    });
    const fixture = TestBed.createComponent(PullListPage);
    fixture.componentRef.setInput('owner', 'cport1');
    fixture.componentRef.setInput('slug', 'counter');
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Claude Code (agent for chris portscheller)');
    expect(text).toMatch(/chris portscheller · b9/);
  });
});
