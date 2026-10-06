import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Seo } from './seo/seo';

describe('App', () => {
  it('renders the shell', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.brand')?.getAttribute('aria-label')).toBe('appmarket.org home');

    TestBed.inject(Seo).setHeading([{ label: 'dev' }, { label: 'Hello' }]);
    fixture.detectChanges();
    expect(el.querySelector('.heading')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'dev/Hello',
    );
    expect(el.querySelector('.brand')).toBeNull();
    expect(el.querySelector('.brand-mark .logo')).not.toBeNull();
    expect(el.querySelector('.brand-mark')?.getAttribute('href')).toBe('/');

    TestBed.inject(Seo).setHeading([{ label: 'Dashboard' }]);
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Dashboard');
    expect(el.querySelector('.brand')).toBeNull();
    expect(el.querySelector('.brand-mark .logo')).not.toBeNull();
    expect(el.querySelector('.brand-mark')?.getAttribute('href')).toBe('/');
    expect(el.querySelector('a[routerLink="/dashboard"]')).toBeNull();

    TestBed.inject(Seo).setHeading([]);
    fixture.detectChanges();
    expect(el.querySelector('.brand')).not.toBeNull();
    expect(el.querySelector('.heading')).toBeNull();
    expect(el.querySelector('.brand-mark')).toBeNull();
  });
});

it('uses app chrome on signed-in interior pages and retains marketing chrome on the homepage', async () => {
  const { Auth } = await import('./auth/auth');
  const { signal } = await import('@angular/core');
  const user = signal({ id: 'dev', name: 'Dev', image: null });
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      {
        provide: Auth,
        useValue: { user, owner: signal(null), load: async () => user() },
      },
    ],
  });
  const fixture = TestBed.createComponent(App);
  const seo = TestBed.inject(Seo);
  seo.setHeading([{ label: 'Dashboard' }]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  expect(el.querySelector('main.workspace')).not.toBeNull();
  expect(el.querySelector('.product-link')).toBeNull();
  expect(el.querySelector('footer')).toBeNull();
  expect(el.querySelector('.brand-mark .logo')).not.toBeNull();
  seo.setHeading([]);
  fixture.detectChanges();
  expect(el.querySelector('main.workspace')).toBeNull();
  expect(el.querySelector('.product-link')).toBeNull();
  expect(el.querySelector('footer')).not.toBeNull();
});

it('signed in: the logo goes to the dashboard, no Dashboard link, a search box and a create menu', async () => {
  const { Auth } = await import('./auth/auth');
  const { signal } = await import('@angular/core');
  const { Router } = await import('@angular/router');
  const user = signal({ id: 'dev', name: 'Dev', image: null });
  TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter([]), { provide: Auth, useValue: { user, owner: signal(null), orgs: signal([]), load: async () => user() } }],
  });
  const fixture = TestBed.createComponent(App);
  TestBed.inject(Seo).setHeading([{ label: 'cport1' }, { label: 'bombfind' }]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  expect(el.querySelector('.brand-mark')?.getAttribute('href')).toBe('/dashboard');
  expect([...el.querySelectorAll('mat-toolbar a')].some((a) => a.textContent?.trim() === 'Dashboard')).toBe(false);
  expect(el.querySelector('.create-trigger')).not.toBeNull();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const input = el.querySelector<HTMLInputElement>('.toolbar-search input')!;
  input.value = '  mines  ';
  el.querySelector('.toolbar-search')!.dispatchEvent(new Event('submit'));
  expect(navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: 'mines' } });
  expect(input.value).toBe('');
});
