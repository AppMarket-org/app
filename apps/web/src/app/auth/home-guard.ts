import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { Auth } from './auth';

/** The public homepage is for visitors; signed-in users land in their workspace. */
export const homeGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return await auth.load()
    ? new RedirectCommand(router.createUrlTree(['/dashboard']), { replaceUrl: true })
    : true;
};
