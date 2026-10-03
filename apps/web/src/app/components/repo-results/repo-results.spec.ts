import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RepoPage } from '@appmarket/shared';
import { RepoResults } from './repo-results';

function render(results: RepoPage, query: Record<string, string | undefined> = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(RepoResults);
  fixture.componentRef.setInput('results', results);
  fixture.componentRef.setInput('query', query);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('RepoResults', () => {
  it('shows the count and an empty message', () => {
    const el = render({ items: [], page: 1, pageSize: 24, total: 0 });
    expect(el.textContent).toContain('0 apps');
    expect(el.textContent).toContain('No apps match');
    expect(el.querySelector('nav')).toBeNull();
  });

  it('links to the next page keeping the query', () => {
    const el = render({ items: [], page: 1, pageSize: 24, total: 50 }, { q: 'cms', runtime: 'static' });
    const next = el.querySelector<HTMLAnchorElement>('a[rel="next"]')!;
    expect(next.getAttribute('href')).toBe('/?q=cms&runtime=static&page=2');
    expect(el.querySelector('a[rel="prev"]')).toBeNull();
    expect(el.textContent).toContain('Page 1 of 3');
  });
});
