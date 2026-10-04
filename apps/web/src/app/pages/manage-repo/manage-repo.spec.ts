import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Repo, RepoState } from '@appmarket/shared';
import { ManageRepo } from './manage-repo';

const repo = (state: RepoState): Repo =>
  ({ id: '1', slug: 'app', name: 'App', summary: 'Summary', state, runtime: 'workers-js', platforms: ['workers'], owner: { id: 'o', handle: 'dev', kind: 'user', name: 'Owner' }, fullName: 'dev/app' }) as Repo;

async function setup(state: RepoState) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(ManageRepo);
  fixture.componentRef.setInput('owner', 'dev');
  fixture.componentRef.setInput('slug', 'app');
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  const flushLoad = async (s: RepoState) => {
    http.expectOne('/api/repos/dev/app').flush(repo(s));
    await fixture.whenStable();
    http.expectOne('/api/repos/dev/app/git').flush({ name: 'app-1', remote: 'https://acct.artifacts.cloudflare.net/git/dev/app-1.git' });
    http.expectOne('/api/repos/dev/app/events').flush({ items: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await flushLoad(state);
  return { fixture, http, flushLoad, el: fixture.nativeElement as HTMLElement };
}

function submit(el: HTMLElement, fixture: { detectChanges(): void }, tag: string) {
  const input = el.querySelector<HTMLInputElement>('app-manage-repo form input[formcontrolname="tag"], form:not(.upload) input[formcontrolname="tag"]')!;
  input.value = tag;
  input.dispatchEvent(new Event('input'));
  input.closest('form')!.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

describe('ManageRepo', () => {
  it('offers submit and remove for a draft, withdraw for a submitted repo', async () => {
    const draft = await setup('draft');
    expect(draft.el.querySelector('textarea[formcontrolname="releaseNotes"]')).not.toBeNull();
    expect(draft.el.textContent).toContain('Delete repo');
    expect(draft.el.textContent).not.toContain('Withdraw');
    TestBed.resetTestingModule();
    const submitted = await setup('submitted');
    expect(submitted.el.querySelector('textarea[formcontrolname="releaseNotes"]')).toBeNull();
    expect(submitted.el.textContent).toContain('Withdraw from review');
  });

  it('explains a missing tag and runtime problems', async () => {
    const { el, fixture, http } = await setup('draft');
    submit(el, fixture, 'v9');
    http.expectOne('/api/repos/dev/app/transitions').flush({ error: 'tag_not_found', tag: 'v9' }, { status: 422, statusText: 'Unprocessable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('form .error')?.textContent).toContain('git push appmarket v9');

    submit(el, fixture, 'v0');
    http.expectOne('/api/repos/dev/app/transitions').flush({ error: 'runtime_mismatch', issues: ['Add a Wrangler config.'] }, { status: 422, statusText: 'Unprocessable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('form .error mat-list-item')?.textContent?.trim()).toContain('Add a Wrangler config.');
  });

  it('submits a tag, reloads, and leaves no error state behind', async () => {
    const { el, fixture, http, flushLoad } = await setup('draft');
    submit(el, fixture, 'v1.0.0');
    const req = http.expectOne('/api/repos/dev/app/transitions');
    expect(req.request.body).toEqual({ to: 'submitted', tag: 'v1.0.0', releaseNotes: '' });
    req.flush(repo('submitted'));
    await fixture.whenStable();
    await flushLoad('submitted');
    expect(el.textContent).toContain('In review');
    expect(el.querySelector('mat-error')).toBeNull();
  });
});
