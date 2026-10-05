import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Repo } from '@appmarket/shared';
import { Auth } from '../../auth/auth';
import { RepoPage } from './repo';
import type { RepoDetails } from './repo-resolver';

function render(state: 'draft' | 'published') {
  const repo = {
    name: 'Angular Example App',
    summary: 'Angular Example App',
    fullName: 'dev/angular-example-app',
    slug: 'angular-example-app',
    description: 'Build an Angular app.',
    owner: { id: 'dev', handle: 'dev', name: 'Dev' },
    state,
    runtime: 'workers-js',
    platforms: ['workers'],
    priceCents: 0,
  } as Repo;
  const details: RepoDetails = {
    repo,
    versions: [],
    screenshots: [],
    readme: null,
    releases: [],
    history: null,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: Auth,
        useValue: {
          user: signal({ id: 'dev', role: 'developer' }),
          orgs: signal([]),
          load: async () => ({ id: 'dev' }),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: { details },
            paramMap: convertToParamMap({ owner: 'dev', slug: repo.slug }),
            queryParamMap: convertToParamMap({}),
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RepoPage);
  fixture.componentRef.setInput('details', details);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}
it('shows a private app overview with code and version preparation instead of an unavailable published clone action', () => {
  const el = render('draft');
  expect(el.querySelector('header')?.textContent?.match(/Angular Example App/g)).toHaveLength(1);
  expect(el.querySelector('app-get-code')).toBeNull();
  expect(el.textContent).toContain('Prepare a version');
  expect(el.textContent).not.toContain('Not public: draft');
  expect(el.querySelector('a[href="/dev/angular-example-app/code"]')).not.toBeNull();
  expect(el.querySelector('a[href="/dashboard/repos/dev/angular-example-app"]')).not.toBeNull();
});
it('keeps published cloning and deployment actions on public apps', () => {
  const el = render('published');
  expect(el.querySelector('app-get-code')).not.toBeNull();
  expect(el.querySelector('app-deploy-action')).not.toBeNull();
  expect(el.querySelector('.publication')).toBeNull();
});
