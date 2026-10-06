import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth, type CurrentUser } from '../../auth/auth';
import { CowbellButton } from './cowbell-button';

function setup(user: CurrentUser | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: Auth, useValue: { user: signal(user) } }],
  });
  const fixture = TestBed.createComponent(CowbellButton);
  fixture.componentRef.setInput('path', 'dev/app');
  fixture.componentRef.setInput('name', 'App');
  fixture.componentRef.setInput('initialCount', 3);
  fixture.detectChanges();
  return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

const user = { id: 'u1', name: 'U', email: 'u@example.test', image: null, role: 'buyer' } as CurrentUser;

describe('CowbellButton', () => {
  it('sends signed-out visitors to sign in and back', () => {
    const { el } = setup(null);
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/login?next=%2Fdev%2Fapp');
    expect(el.textContent).toContain('3');
  });

  it('loads the user state, rings, and settles on the server count', async () => {
    const { fixture, http, el } = setup(user);
    http.expectOne('/api/repos/dev/app/cowbell').flush({ cowbelled: false, count: 3 });
    await fixture.whenStable();
    fixture.detectChanges();

    el.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    fixture.detectChanges();
    expect(el.textContent).toContain('Cowbelled');
    expect(el.querySelector('mat-icon.ringing')).not.toBeNull();
    const ring = http.expectOne('/api/repos/dev/app/cowbell');
    expect(ring.request.method).toBe('PUT');
    ring.flush({ cowbelled: true, count: 4 });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.count')!.textContent).toBe('4');
    el.querySelector('mat-icon')!.dispatchEvent(new Event('animationend'));
    fixture.detectChanges();
    expect(el.querySelector('mat-icon.ringing')).toBeNull();
    el.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    fixture.detectChanges();
    expect(el.querySelector('mat-icon.ringing')).toBeNull();
    http.expectOne('/api/repos/dev/app/cowbell').flush({ cowbelled: false, count: 3 });
    await fixture.whenStable();
  });

  it('reverts if ringing fails', async () => {
    const { fixture, http, el } = setup(user);
    http.expectOne('/api/repos/dev/app/cowbell').flush({ cowbelled: false, count: 3 });
    await fixture.whenStable();
    el.querySelector('button')!.click();
    http.expectOne('/api/repos/dev/app/cowbell').flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('.count')!.textContent).toBe('3');
  });
});
