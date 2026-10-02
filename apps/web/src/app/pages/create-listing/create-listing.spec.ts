import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CreateListing } from './create-listing';

/** The protected members the tests drive. */
interface Internals {
  form: { patchValue(value: object): void; controls: Record<string, { getError(key: string): unknown }> };
  submit(): Promise<void>;
  serverError(): string | null;
}

function setup() {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(CreateListing);
  fixture.detectChanges();
  const cmp = fixture.componentInstance as unknown as Internals;
  cmp.form.patchValue({ name: 'My App', summary: 'Does useful things', category: 'ai', license: 'MIT' });
  return { fixture, cmp, http: TestBed.inject(HttpTestingController) };
}

describe('CreateListing', () => {
  it('posts the listing and opens it', async () => {
    const { cmp, http } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const done = cmp.submit();
    const req = http.expectOne('/api/listings');
    expect(req.request.body).toMatchObject({ name: 'My App', category: 'ai', runtime: 'workers-js', platforms: ['workers'], license: 'MIT' });
    req.flush({ slug: 'my-app' });
    await done;
    expect(navigate).toHaveBeenCalledWith(['/apps', 'my-app']);
  });

  it('puts server validation messages on the fields', async () => {
    const { cmp, http } = setup();
    const done = cmp.submit();
    http.expectOne('/api/listings').flush({ error: 'invalid', issues: [{ path: 'summary', message: 'Too short' }] }, { status: 400, statusText: 'Bad Request' });
    await done;
    expect(cmp.form.controls['summary']!.getError('server')).toBe('Too short');
    expect(cmp.serverError()).toBe('Please fix the highlighted fields.');
  });

  it('explains the listing limit and rate limiting', async () => {
    const { cmp, http } = setup();
    let done = cmp.submit();
    http.expectOne('/api/listings').flush({ error: 'quota_exceeded', limit: 25 }, { status: 409, statusText: 'Conflict' });
    await done;
    expect(cmp.serverError()).toContain('limit of 25 listings');
    done = cmp.submit();
    http.expectOne('/api/listings').flush({ error: 'rate_limited' }, { status: 429, statusText: 'Too Many Requests' });
    await done;
    expect(cmp.serverError()).toContain('Wait a minute');
  });

  it('does not post an invalid form', async () => {
    const { cmp, http } = setup();
    cmp.form.patchValue({ license: 'not a license!' });
    await cmp.submit();
    http.expectNone('/api/listings');
  });
});
