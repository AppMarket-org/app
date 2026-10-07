import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CloudflareApi } from '../../../api/cloudflare';
import { PreviewsCard } from './previews-card';

async function render(previews: unknown = { settings: null, items: [] }) {
  const post = vi.fn(() => of({ id: 'dep1', already: false }));
  const put = vi.fn(() => of({ ok: true }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: HttpClient, useValue: { get: vi.fn(() => of(previews)), post, put, delete: vi.fn() } },
      { provide: CloudflareApi, useValue: { connectUrl: () => '/connect', accounts: () => of([{ id: 'a'.repeat(32), name: 'Chris' }]) } },
    ],
  });
  const fixture = TestBed.createComponent(PreviewsCard);
  fixture.componentRef.setInput('path', 'cport1/counter');
  fixture.componentRef.setInput('slug', 'counter');
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, post, put };
}

describe('PreviewsCard', () => {
  it('deploys the default branch now, into the connected account, and opens the deployment', async () => {
    const { el, post, fixture } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const button = [...el.querySelectorAll('mat-card-actions button')].find((b) => b.textContent?.trim().endsWith('Deploy')) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(el.textContent).toContain('In Chris.');
    expect(el.textContent).not.toContain('Save');
    button.click();
    await fixture.whenStable();
    expect(post).toHaveBeenCalledWith('/api/repos/cport1/counter/previews/deploy', { accountId: 'a'.repeat(32), workerName: 'counter', deployDefault: true, previews: false });
    expect(navigate).toHaveBeenCalledWith(['/dashboard/deployments', 'dep1']);
  });

  it('once deployed, offers Save for changed settings and Deploy again', async () => {
    const settings = { enabled: false, deployDefault: true, workerName: 'counter', accountId: 'a'.repeat(32), connectedBy: 'Chris', mine: true };
    const items = [{ branch: 'main', deleted: false, workerName: 'counter', resources: [], commit: 'c147eaac', deploymentId: 'dep1', status: 'succeeded', url: 'https://counter.chris.workers.dev', error: null, updatedAt: '2026-10-07T08:00:00Z' }];
    const { el, put, fixture } = await render({ settings, items });
    expect(el.querySelector('.live')?.textContent).toContain('Live');
    const actions = () => [...el.querySelectorAll('mat-card-actions button')] as HTMLButtonElement[];
    expect(actions().map((b) => b.textContent?.trim())).toEqual(['refreshDeploy again', 'Save']);
    expect(actions()[1]!.disabled).toBe(true);
    (el.querySelectorAll('mat-slide-toggle button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(actions()[1]!.disabled).toBe(false);
    actions()[1]!.click();
    await fixture.whenStable();
    expect(put).toHaveBeenCalledWith('/api/repos/cport1/counter/previews', { enabled: true, deployDefault: true, workerName: 'counter', accountId: 'a'.repeat(32) });
  });
});
