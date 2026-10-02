import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Role } from '@appmarket/shared';
import { Auth } from './auth';

/** Allows signed-in users (optionally with one of `roles`); otherwise redirects to /login. */
export function authGuard(...roles: Role[]): CanActivateFn {
  return async (_route, state) => {
    // inject() only works before the first await.
    const auth = inject(Auth);
    const router = inject(Router);
    const user = await auth.load();
    if (!user) {
      return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
    }
    return roles.length === 0 || roles.includes(user.role) ? true : router.createUrlTree(['/']);
  };
}
