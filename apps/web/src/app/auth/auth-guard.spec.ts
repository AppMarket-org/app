import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { Auth, type CurrentUser } from './auth';
import { authGuard } from './auth-guard';

const developer: CurrentUser = { id: 'u1', name: 'Dev', email: 'dev@example.com', image: null, role: 'developer' };

function run(guardRoles: Parameters<typeof authGuard>, user: CurrentUser | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Auth, useValue: { load: async () => user } }],
  });
  const state = { url: '/dashboard' } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() => authGuard(...guardRoles)({} as ActivatedRouteSnapshot, state)) as Promise<boolean | UrlTree>;
}

describe('authGuard', () => {
  it('redirects signed-out users to /login with next', async () => {
    const result = await run([], null);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login?next=%2Fdashboard');
  });

  it('allows signed-in users', async () => {
    expect(await run([], developer)).toBe(true);
  });

  it('sends users without the role home', async () => {
    const result = await run(['admin'], developer);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });
});
