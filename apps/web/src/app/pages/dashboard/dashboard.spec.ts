import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CowbellsApi } from '../../api/cowbells';
import { DeploymentsApi } from '../../api/deployments';
import { Developer } from '../../api/developer';
import { Dashboard } from './dashboard';

it('shows a repository name once when its summary repeats it, and keeps workspace actions', async () => {
  TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [
      provideRouter([]),
      {
        provide: Developer,
        useValue: {
          mine: () =>
            of([
              {
                id: '1',
                name: 'Angular Example App',
                summary: 'Angular Example App',
                fullName: 'dev/angular-example-app',
                runtime: 'workers-js',
                state: 'draft',
                updatedAt: '2026-10-04T00:00:00Z',
              },
            ]),
        },
      },
      { provide: DeploymentsApi, useValue: { mine: () => of([]) } },
      { provide: CowbellsApi, useValue: { mine: () => of([]) } },
      { provide: HttpClient, useValue: { get: () => of({ items: [] }) } },
    ],
  });
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  expect(el.querySelector('h1')).toBeNull();
  expect(el.querySelector('.repo-row')?.textContent?.match(/Angular Example App/g)).toHaveLength(1);
  expect(el.querySelector('a[aria-label="Manage Angular Example App"]')?.getAttribute('href')).toBe(
    '/dashboard/repos/dev/angular-example-app',
  );
  expect(el.querySelector('a[href="/dashboard/new"]')).not.toBeNull();
  expect(el.querySelector('a[href="/dashboard/cloudflare"]')).not.toBeNull();
});
