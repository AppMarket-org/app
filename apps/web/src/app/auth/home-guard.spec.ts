import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { Auth } from './auth';
import { homeGuard } from './home-guard';

@Component({ template: 'Public homepage' })
class HomeStub {}
@Component({ template: 'Dashboard' })
class DashboardStub {}
@Component({ template: 'Repository' })
class RepoStub {}

describe('homepage destination', () => {
  function setup(user: object | null) {
    const latest = vi.fn(() => []);
    TestBed.configureTestingModule({ providers: [
      { provide: Auth, useValue: { load: async () => user } },
      provideRouter([
        { path: '', pathMatch: 'full', canActivate: [homeGuard], resolve: { latest }, component: HomeStub },
        { path: 'dashboard', component: DashboardStub },
        { path: ':owner/:slug/code', component: RepoStub },
      ]),
    ] });
    return latest;
  }

  it('opens the dashboard for a signed-in root visit before resolving homepage data', async () => {
    const latest = setup({ id: 'signed-in' });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/?utm_source=link', DashboardStub);
    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(latest).not.toHaveBeenCalled();
  });

  it('keeps the public homepage for signed-out visitors', async () => {
    const latest = setup(null);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', HomeStub);
    expect(TestBed.inject(Router).url).toBe('/');
    expect(latest).toHaveBeenCalledOnce();
  });

  it('preserves signed-in repository deep links', async () => {
    setup({ id: 'signed-in' });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/cport1/angular-example-app/code?ref=master', RepoStub);
    expect(TestBed.inject(Router).url).toBe('/cport1/angular-example-app/code?ref=master');
  });
});
