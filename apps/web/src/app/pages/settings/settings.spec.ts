import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OwnersApi } from '../../api/owners';
import { Auth } from '../../auth/auth';
import { routes } from '../../app.routes';

function setup() {
  const owner = { id: 'user', name: 'Example', handle: 'example', kind: 'user', avatarUrl: null };
  const me = vi.fn(() => of({ owner, orgs: [] }));
  const updateProfile = vi.fn();
  TestBed.configureTestingModule({ providers: [
    provideRouter(routes.filter((r) => r.path === 'settings' || r.path === 'settings/:section'), withComponentInputBinding()),
    { provide: Auth, useValue: { load: async () => ({ id: 'user' }), refreshOwner: vi.fn() } },
    { provide: OwnersApi, useValue: {
      me, profile: () => of({ owner, profile: { memberSince: '2026-10-01' }, privacy: { privateContributions: false, hideActivity: false, hideLocation: false } }),
      sessions: () => of([]), updateProfile,
    } },
    { provide: HttpClient, useValue: { get: () => of({ impacts: true, pulls: true, sending: true }) } },
  ] });
  return { me, updateProfile };
}

it('redirects Settings to Profile and keeps unsaved edits when switching sections', async () => {
  const api = setup();
  const harness = await RouterTestingHarness.create('/settings');
  await harness.fixture.whenStable();
  const el = harness.routeNativeElement!;
  const name = el.querySelector<HTMLInputElement>('app-profile-form input[autocomplete="name"]')!;
  name.value = 'Unsaved draft';
  name.dispatchEvent(new Event('input'));
  await harness.fixture.whenStable();
  await harness.navigateByUrl('/settings/privacy');
  expect(el.querySelector('.settings-section:not([hidden])')?.getAttribute('aria-label')).toBe('Privacy settings');
  expect(el.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/settings/privacy');
  await harness.navigateByUrl('/settings/profile');
  expect(el.querySelector('app-profile-form input[autocomplete="name"]')).toBe(name);
  expect(name.value).toBe('Unsaved draft');
  expect(api.me).toHaveBeenCalledOnce();
  expect(api.updateProfile).not.toHaveBeenCalled();
});

it('opens Tokens & devices directly and keeps other settings out of the view', async () => {
  setup();
  const harness = await RouterTestingHarness.create('/settings/access');
  const el = harness.routeNativeElement!;
  expect(el.querySelector('.settings-section:not([hidden])')?.getAttribute('aria-label')).toBe('Access settings');
  expect(el.textContent).toContain('New CI token');
  expect(el.querySelector('app-profile-form')).toBeNull();
});

it('redirects unknown settings sections to Profile', async () => {
  setup();
  const harness = await RouterTestingHarness.create('/settings/unknown');
  expect(harness.routeNativeElement!.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/settings/profile');
});
