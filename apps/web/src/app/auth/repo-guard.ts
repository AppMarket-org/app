import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { type CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Developer } from '../api/developer';

/**
 * A repo's code and pull request pages open only when the visitor may see the repo. Otherwise they
 * show "Page not found" at the same URL, so a private repo's name is not confirmed to strangers.
 */
export const repoGuard: CanActivateFn = async (route) => {
  // inject() only works before the first await.
  const api = inject(Developer);
  const router = inject(Router);
  try {
    await firstValueFrom(api.repo(`${route.paramMap.get('owner')}/${route.paramMap.get('slug')}`));
    return true;
  } catch (error) {
    if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)) {
      return new RedirectCommand(router.parseUrl('/404'), { skipLocationChange: true });
    }
    // Anything else (offline, a server error): let the page load and show its own error.
    return true;
  }
};
