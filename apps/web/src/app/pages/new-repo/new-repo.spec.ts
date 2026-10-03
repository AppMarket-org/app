import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { RepoInput } from '@appmarket/shared';
import { NewRepo } from './new-repo';

const input: RepoInput = { name: 'My App', summary: 'Does useful things', description: '', category: 'ai', runtime: 'workers-js', platforms: ['workers'], license: 'MIT' };

describe('NewRepo', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }));

  it('creates the draft and opens its dashboard page', async () => {
    const cmp = TestBed.createComponent(NewRepo).componentInstance as unknown as { create(i: RepoInput): Promise<void> };
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const done = cmp.create(input);
    const req = TestBed.inject(HttpTestingController).expectOne('/api/repos');
    expect(req.request.body).toEqual(input);
    req.flush({ slug: 'my-app', fullName: 'dev/my-app' });
    await done;
    expect(navigate).toHaveBeenCalledWith('/dashboard/repos/dev/my-app');
  });

  it('passes server field errors to the form', async () => {
    const fixture = TestBed.createComponent(NewRepo);
    const cmp = fixture.componentInstance as unknown as { create(i: RepoInput): Promise<void>; fieldErrors(): Record<string, string>; errorMessage(): string | null };
    const done = cmp.create(input);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/repos')
      .flush({ error: 'invalid', issues: [{ path: 'summary', message: 'Too short' }] }, { status: 400, statusText: 'Bad Request' });
    await done;
    expect(cmp.fieldErrors()).toEqual({ summary: 'Too short' });
    expect(cmp.errorMessage()).toBe('Please fix the highlighted fields.');
  });
});
