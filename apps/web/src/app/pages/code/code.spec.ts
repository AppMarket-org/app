import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';
import { CodePage } from './code';

vi.mock('shiki', () => ({ codeToHtml: async (text: string) => `<pre>${text}</pre>` }));

async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const sha = 'a'.repeat(40);
const root = {
  ref: 'main',
  commit: sha,
  path: '',
  editor: true,
  entries: [
    { name: 'src', type: 'tree' },
    { name: 'README.md', type: 'blob' },
  ],
};
const base = '/api/repos/dev/app/code';

async function setup(file?: string) {
  const query = new BehaviorSubject(convertToParamMap(file ? { file } : {}));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({ owner: 'dev', slug: 'app' }) },
          queryParamMap: query,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CodePage);
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  http.expectOne(base + '/tree').flush(root);
  await tick();
  http.expectOne(base + '/branches').flush({ branches: ['main', 'feature'] });
  await tick();
  await tick();
  fixture.detectChanges();
  return { fixture, http, query, navigate, el: fixture.nativeElement as HTMLElement };
}

it('expands and collapses directories in place and reuses their loaded children', async () => {
  const { fixture, http, navigate, el } = await setup();
  const folder = el.querySelector('button[title="src"]') as HTMLButtonElement;
  folder.click();
  http
    .expectOne((req) => req.url === base + '/tree' && req.params.get('path') === 'src')
    .flush({ ...root, path: 'src', entries: [{ name: 'index.ts', type: 'blob' }] });
  await tick();
  fixture.detectChanges();
  expect(el.querySelector('[title="src/index.ts"]')).not.toBeNull();
  folder.click();
  fixture.detectChanges();
  expect(el.querySelector('[title="src/index.ts"]')).toBeNull();
  folder.click();
  fixture.detectChanges();
  expect(el.querySelector('[title="src/index.ts"]')).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  http.verify();
});

it('searches nested file paths and opens a result without changing the route', async () => {
  const { fixture, http, navigate, el } = await setup();
  const input = el.querySelector('input')!;
  input.dispatchEvent(new Event('focus'));
  input.dispatchEvent(new Event('focusin'));
  http
    .expectOne((req) => req.url === base + '/files' && req.params.get('ref') === sha)
    .flush({ files: ['src/index.ts', 'README.md'], complete: true });
  await tick();
  fixture.detectChanges();
  input.value = 'index';
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
  const options = [...document.querySelectorAll('mat-option')];
  expect(options.some((option) => option.textContent?.includes('README.md'))).toBe(false);
  (options.find((option) => option.textContent?.includes('src/index.ts')) as HTMLElement).click();
  expect(navigate).toHaveBeenCalledWith(
    [],
    expect.objectContaining({ queryParams: { ref: null, file: 'src/index.ts' } }),
  );
  http.verify();
});

it('ignores an old file response after another file is selected and does not reload the tree', async () => {
  const { fixture, http, query } = await setup();
  query.next(convertToParamMap({ file: 'README.md' }));
  await tick();
  const old = http.expectOne((req) => req.url === base + '/blob');
  query.next(convertToParamMap({ file: 'package.json' }));
  await tick();
  const current = http.expectOne((req) => req.url === base + '/blob');
  current.flush({ path: 'package.json', size: 2, text: '{}', binary: false, tooLarge: false });
  await fixture.whenStable();
  old.flush({ path: 'README.md', size: 3, text: 'old', binary: false, tooLarge: false });
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.code')?.textContent).toContain('{}');
  expect(fixture.nativeElement.querySelector('.code')?.textContent).not.toContain('old');
  http.verify();
});

it('keeps the selected file when switching branches and pins its read to the new commit', async () => {
  const { http, query } = await setup();
  query.next(convertToParamMap({ ref: 'feature', file: 'README.md' }));
  const commit = 'b'.repeat(40);
  http
    .expectOne((req) => req.url === base + '/tree' && req.params.get('ref') === 'feature')
    .flush({ ...root, ref: 'feature', commit });
  await tick();
  http.expectOne(base + '/branches').flush({ branches: ['main', 'feature'] });
  await tick();
  await tick();
  http
    .expectOne(
      (req) =>
        req.url === base + '/blob' &&
        req.params.get('ref') === commit &&
        req.params.get('path') === 'README.md',
    )
    .flush({ path: 'README.md', size: 0, text: null, binary: false, tooLarge: false });
  await tick();
  http.verify();
});
