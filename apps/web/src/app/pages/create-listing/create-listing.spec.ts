import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ListingInput } from '@appmarket/shared';
import { CreateListing } from './create-listing';

const input: ListingInput = { name: 'My App', summary: 'Does useful things', description: '', category: 'ai', runtime: 'workers-js', platforms: ['workers'], license: 'MIT' };

describe('CreateListing', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }));

  it('creates the draft and opens its dashboard page', async () => {
    const cmp = TestBed.createComponent(CreateListing).componentInstance as unknown as { create(i: ListingInput): Promise<void> };
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const done = cmp.create(input);
    const req = TestBed.inject(HttpTestingController).expectOne('/api/listings');
    expect(req.request.body).toEqual(input);
    req.flush({ slug: 'my-app' });
    await done;
    expect(navigate).toHaveBeenCalledWith(['/dashboard/apps', 'my-app']);
  });

  it('passes server field errors to the form', async () => {
    const fixture = TestBed.createComponent(CreateListing);
    const cmp = fixture.componentInstance as unknown as { create(i: ListingInput): Promise<void>; fieldErrors(): Record<string, string>; errorMessage(): string | null };
    const done = cmp.create(input);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/listings')
      .flush({ error: 'invalid', issues: [{ path: 'summary', message: 'Too short' }] }, { status: 400, statusText: 'Bad Request' });
    await done;
    expect(cmp.fieldErrors()).toEqual({ summary: 'Too short' });
    expect(cmp.errorMessage()).toBe('Please fix the highlighted fields.');
  });
});
