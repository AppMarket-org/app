import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { RedirectCommand, Router, convertToParamMap, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { type Observable, of, throwError } from 'rxjs';
import { Developer } from '../api/developer';
import { repoGuard } from './repo-guard';

function run(repo: () => Observable<unknown>) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: Developer, useValue: { repo } }] });
  const route = { paramMap: convertToParamMap({ owner: 'cport1', slug: 'bombfind' }) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => repoGuard(route, {} as RouterStateSnapshot)) as Promise<boolean | RedirectCommand>;
}

describe('repoGuard', () => {
  it('opens repos the visitor can see', async () => {
    expect(await run(() => of({}))).toBe(true);
  });

  it('shows Page not found, at the same URL, for a repo the visitor cannot see', async () => {
    const result = await run(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(result).toBeInstanceOf(RedirectCommand);
    const command = result as RedirectCommand;
    expect(TestBed.inject(Router).serializeUrl(command.redirectTo)).toBe('/404');
    expect(command.navigationBehaviorOptions?.skipLocationChange).toBe(true);
  });

  it('lets the page handle other errors', async () => {
    expect(await run(() => throwError(() => new HttpErrorResponse({ status: 503 })))).toBe(true);
  });
});
