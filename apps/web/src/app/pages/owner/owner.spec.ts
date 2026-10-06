import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { OwnersApi, type OwnerPage as OwnerData } from '../../api/owners';
import { Auth } from '../../auth/auth';
import { Seo } from '../../seo/seo';
import { OwnerPage } from './owner';

it('updates the workspace heading when navigating between profiles with a reused component', async () => {
  TestBed.configureTestingModule({ imports: [OwnerPage], providers: [
    provideRouter([]),
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ owner: 'first' }) } } },
    { provide: Auth, useValue: { owner: () => null, orgs: () => [] } },
    { provide: OwnersApi, useValue: {} },
  ] });
  const page = (handle: string): OwnerData => ({
    owner: { id: handle, handle, name: handle, kind: 'org', avatarUrl: null },
    profile: null, repos: [], pinned: [], pinnedFallback: true,
  });
  const fixture = TestBed.createComponent(OwnerPage);
  fixture.componentRef.setInput('page', page('first'));
  await fixture.whenStable();
  expect(TestBed.inject(Seo).heading()).toEqual([{ label: 'first' }]);
  fixture.componentRef.setInput('page', page('second'));
  await fixture.whenStable();
  expect(TestBed.inject(Seo).heading()).toEqual([{ label: 'second' }]);
  expect(fixture.nativeElement.querySelector('.handle').textContent).toBe('second');
  fixture.componentRef.setInput('page', null);
  await fixture.whenStable();
  const missing = fixture.nativeElement as HTMLElement;
  expect(missing.querySelector('app-not-found-view img')?.getAttribute('src')).toBe('/brand/404.webp');
  expect(missing.textContent).toContain('There is no user or organization with that name.');
  expect(missing.querySelector('app-not-found-view a')?.getAttribute('href')).toBe('/');
  expect(missing.querySelector('.handle')).toBeNull();
});
