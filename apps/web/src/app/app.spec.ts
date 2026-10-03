import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Seo } from './seo/seo';

describe('App', () => {
  it('renders the shell', async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toBe('appmarket.org home');

    TestBed.inject(Seo).setHeading([{ label: 'dev' }, { label: 'Hello' }]);
    fixture.detectChanges();
    expect(el.querySelector('.heading')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('dev / Hello');
  });
});
