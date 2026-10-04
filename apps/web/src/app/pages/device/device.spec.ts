import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../../auth/auth';
import { DevicePage } from './device';

function setup(code?: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: Auth, useValue: { user: signal({ id: 'u1', name: 'U' }), owner: signal({ handle: 'bea' }) } }],
  });
  const fixture = TestBed.createComponent(DevicePage);
  if (code) fixture.componentRef.setInput('user_code', code);
  fixture.detectChanges();
  // Let the page's awaits (request, then finally) finish before looking.
  const settle = async () => {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  return { fixture, settle, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

describe('DevicePage', () => {
  it('checks a prefilled code, names the client and approves it', async () => {
    const { fixture, settle, http, el } = setup('abcd-efgh');
    http.expectOne((r) => r.url === '/api/auth/device' && r.params.get('user_code') === 'ABCDEFGH').flush({ status: 'pending', client_id: 'appmarket-cli' });
    await settle();
    expect(el.textContent).toContain('appmarket CLI wants to sign in');
    expect(el.querySelector('.code-display')?.textContent).toBe('ABCD-EFGH');

    // #132: Approve waits for the Turnstile check.
    (fixture.componentInstance as unknown as { captchaToken: { set(v: string): void } }).captchaToken.set('turnstile-token');
    fixture.detectChanges();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve'))!.click();
    const approve = http.expectOne('/api/auth/device/approve');
    expect(approve.request.body).toEqual({ userCode: 'ABCDEFGH' });
    expect(approve.request.headers.get('x-captcha-response')).toBe('turnstile-token');
    approve.flush({ success: true });
    await settle();
    expect(el.textContent).toContain('appmarket CLI is signed in');
  });

  it('explains an expired or used code', async () => {
    const { settle, http, el } = setup('ABCDEFGH');
    http.expectOne((r) => r.url === '/api/auth/device').flush({ error: 'invalid_request' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.textContent).toContain('That code is not valid any more');
  });
});
