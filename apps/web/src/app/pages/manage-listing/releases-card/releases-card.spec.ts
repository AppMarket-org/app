import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ReleasesCard } from './releases-card';

interface Internals {
  form: { patchValue(v: object): void };
  file: { set(f: File | null): void };
  upload(): Promise<void>;
}

async function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(ReleasesCard);
  fixture.componentRef.setInput('slug', 'app');
  fixture.componentRef.setInput('suggestedTag', 'v1.0.0');
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/listings/app/releases').flush({ items: [] });
  return { fixture, http, cmp: fixture.componentInstance as unknown as Internals };
}

describe('ReleasesCard', () => {
  it('uploads the file with tag, platform, file name and its SHA-256', async () => {
    const { cmp, http } = await setup();
    cmp.form.patchValue({ platform: 'windows' });
    cmp.file.set(new File(['abc'], 'setup.zip'));
    const done = cmp.upload();
    await vi.waitFor(() => http.expectOne((r) => r.url === '/api/listings/app/releases' && r.method === 'POST'), { timeout: 2000 }).then((req) => {
      expect(req.request.params.get('tag')).toBe('v1.0.0');
      expect(req.request.params.get('platform')).toBe('windows');
      expect(req.request.params.get('filename')).toBe('setup.zip');
      expect(req.request.params.get('sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      req.flush({ id: 'r1' });
    });
    await vi.waitFor(() => http.expectOne('/api/listings/app/releases').flush({ items: [] }));
    await done;
  });

  it('does not upload without a file', async () => {
    const { cmp, http } = await setup();
    await cmp.upload();
    http.expectNone((r) => r.method === 'POST');
  });
});
