import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CowbellsApi } from '../../api/cowbells';
import { DeploymentsApi } from '../../api/deployments';
import { Developer } from '../../api/developer';
import { Auth } from '../../auth/auth';
import { routes } from '../../app.routes';

function setup() {
  const repos = vi.fn(() => of([{ id: '1', name: 'Angular Example App', summary: 'Angular Example App', fullName: 'dev/angular-example-app', runtime: 'workers-js', state: 'draft', updatedAt: '2026-10-04T00:00:00Z' }]));
  const deployments = vi.fn(() => of([]));
  const cowbells = vi.fn(() => of([]));
  const http = vi.fn((url: string) => of(url === '/api/me/counts' ? { repositories: 1, apps: 7, cowbells: 2 } : { items: [] }));
  TestBed.configureTestingModule({ providers: [
    provideRouter([routes.find((r) => r.path === 'dashboard')!]),
    { provide: Auth, useValue: { load: async () => ({ id: 'user' }) } },
    { provide: Developer, useValue: { mine: repos } },
    { provide: DeploymentsApi, useValue: { mine: deployments } },
    { provide: CowbellsApi, useValue: { mine: cowbells } },
    { provide: HttpClient, useValue: { get: http } },
  ] });
  TestBed.inject(MatIconRegistry).addSvgIconLiteral('cowbell', TestBed.inject(DomSanitizer).bypassSecurityTrustHtml('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  return { repos, deployments, cowbells, http };
}

it('separates dashboard pages and only requests the active section data', async () => {
  const api = setup();
  const harness = await RouterTestingHarness.create('/dashboard');
  let el = harness.routeNativeElement!;
  expect(el.querySelector('.repo-row')?.textContent?.match(/Angular Example App/g)).toHaveLength(1);
  expect(el.querySelector('a[aria-label="Manage Angular Example App"]')?.getAttribute('href')).toBe('/dashboard/repos/dev/angular-example-app');
  expect(el.querySelector('a[href="/dashboard/new"]')).not.toBeNull();
  expect(el.querySelector('.deployments')).toBeNull();
  expect(el.querySelector('.saved')).toBeNull();
  expect(api.deployments).not.toHaveBeenCalled();
  expect(api.cowbells).not.toHaveBeenCalled();

  await harness.navigateByUrl('/dashboard/apps');
  el = harness.routeNativeElement!;
  expect(el.querySelector('.deployments')).not.toBeNull();
  expect(el.querySelector('a[href="/dashboard/cloudflare"]')).not.toBeNull();
  expect(el.querySelector('.repositories')).toBeNull();
  expect(api.deployments).toHaveBeenCalledOnce();
  expect(api.http).toHaveBeenCalledWith('/api/me/purchases');
  expect(api.cowbells).not.toHaveBeenCalled();
  expect(el.querySelector('a[href="/dashboard/apps"]')?.getAttribute('aria-selected')).toBe('true');

  await harness.navigateByUrl('/dashboard/cowbells');
  el = harness.routeNativeElement!;
  expect(el.querySelector('.saved')).not.toBeNull();
  expect(el.querySelector('.deployments')).toBeNull();
  expect(el.querySelector('.repositories')).toBeNull();
  expect(api.cowbells).toHaveBeenCalledOnce();
  expect(el.querySelector('a[href="/dashboard/cowbells"]')?.getAttribute('aria-selected')).toBe('true');
});

it('supports directly opening a cowbells URL without loading repository or deployment data', async () => {
  const api = setup();
  const harness = await RouterTestingHarness.create('/dashboard/cowbells');
  expect(harness.routeNativeElement!.querySelector('.saved')).not.toBeNull();
  expect(api.repos).not.toHaveBeenCalled();
  expect(api.deployments).not.toHaveBeenCalled();
  expect(api.http).toHaveBeenCalledExactlyOnceWith('/api/me/counts');
});

it("shows every tab's count from the start, holding the badge's place while it loads", async () => {
  setup();
  const harness = await RouterTestingHarness.create('/dashboard/cowbells');
  const counts = [...harness.fixture.nativeElement.querySelectorAll('.tab-count')].map((e: Element) => e.textContent?.trim());
  // Cowbells comes from its own page (no cowbells in the mock), the others from /api/me/counts.
  expect(counts).toEqual(['1', '7', '0']);
});
