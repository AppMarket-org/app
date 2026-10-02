import { TestBed } from '@angular/core/testing';
import { Markdown } from './markdown';

function render(source: string): HTMLElement {
  const fixture = TestBed.createComponent(Markdown);
  fixture.componentRef.setInput('source', source);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Markdown', () => {
  it('renders Markdown with headings moved below the page h1', () => {
    const el = render('# Title\n\n## Section\n\n- item');
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelector('h2')?.textContent).toBe('Title');
    expect(el.querySelector('h3')?.textContent).toBe('Section');
    expect(el.querySelector('li')?.textContent).toBe('item');
  });

  it('strips scripts, event handlers and javascript: links', () => {
    const el = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">x</a>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
    // Angular rewrites unsafe URLs to "unsafe:..." so the browser will not run them.
    expect(el.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
});
