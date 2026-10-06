import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Auth } from './auth';

it('shares the startup session request between the shell and route guards', async () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: 'browser' }] });
  const auth = TestBed.inject(Auth);
  const http = TestBed.inject(HttpTestingController);
  const shell = auth.load();
  const guard = auth.load();
  expect(shell).toBe(guard);
  http.expectOne('/api/auth/get-session').flush({ user: { id: 'dev', name: 'Dev', email: 'dev@example.com', image: null, role: 'developer' } });
  expect((await guard)?.id).toBe('dev');
  http.expectOne('/api/me/owner').flush({ owner: null, orgs: [] });
  expect((await auth.load())?.id).toBe('dev');
  http.verify();
});

it('settles startup as signed out when the session request fails', async () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: 'browser' }] });
  const auth = TestBed.inject(Auth);
  const http = TestBed.inject(HttpTestingController);
  const loading = auth.load();
  http.expectOne('/api/auth/get-session').flush({}, { status: 503, statusText: 'Unavailable' });
  expect(await loading).toBeNull();
  expect(auth.user()).toBeNull();
  http.verify();
});
