import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Deployment } from '@appmarket/shared';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DeploymentsApi } from '../../api/deployments';
import { DeploymentPage } from './deployment';

const base: Deployment = {
  id: 'dep1',
  repoFullName: 'cport1/bombfind',
  repoName: 'BombFind',
  versionTag: 'main',
  accountId: 'acct',
  workerName: 'bombfind',
  previewBranch: 'main',
  status: 'succeeded',
  url: 'https://bombfind.cport1.workers.dev',
  domains: [],
  error: null,
  createdAt: '2026-10-06T15:17:33Z',
  updatedAt: '2026-10-06T15:18:28Z',
};

async function render(deployment: Deployment) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: deployment.id }) } } },
      { provide: DeploymentsApi, useValue: { get: vi.fn(() => of(deployment)), logs: vi.fn(() => of('build output')) } },
      { provide: HttpClient, useValue: { get: vi.fn(() => of({ zones: [], domains: [] })) } },
    ],
  });
  const fixture = TestBed.createComponent(DeploymentPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DeploymentPage', () => {
  it('a live app: its name and status, opened on its custom domain, workers.dev as another address, tabs to manage it', async () => {
    const el = await render({ ...base, domains: ['www.bombfind.com', 'bombfind.com'] });
    expect(el.querySelector('h1')?.textContent).toBe('BombFind');
    expect(el.querySelector('.status')?.textContent).toContain('Live');
    const links = [...el.querySelectorAll('.links a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['open_in_newOpen bombfind.com', 'https://bombfind.com'],
      ['www.bombfind.com', 'https://www.bombfind.com'],
      ['bombfind.cport1.workers.dev', 'https://bombfind.cport1.workers.dev'],
    ]);
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())).toEqual(['Domains', 'Variables and secrets', 'Versions', 'Logs', 'Eject']);
    expect(el.textContent).not.toContain('Deploy steps');
  });

  it('without a custom domain it opens workers.dev', async () => {
    const el = await render(base);
    expect([...el.querySelectorAll('.links a')].map((a) => a.getAttribute('href'))).toEqual(['https://bombfind.cport1.workers.dev']);
  });

  it('while deploying: progress and logs, no tabs', async () => {
    const el = await render({ ...base, status: 'building', url: null });
    expect(el.querySelector('.status')?.textContent).toContain('Building');
    expect(el.querySelector('[aria-label="Deploy steps"]')).not.toBeNull();
    expect(el.querySelector('app-logs-card')).not.toBeNull();
    expect(el.querySelector('[role="tab"]:not(app-logs-card [role="tab"])')).toBeNull();
    expect(el.querySelector('.links')).toBeNull();
  });
});
