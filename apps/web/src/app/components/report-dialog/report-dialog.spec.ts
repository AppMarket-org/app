import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ReportDialog } from './report-dialog';

interface Internals {
  form: { patchValue(v: object): void };
  captchaToken: { set(v: string | null): void };
  send(): Promise<void>;
  error(): string | null;
}

function setup() {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MAT_DIALOG_DATA, useValue: { slug: 'app', name: 'App' } },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  // Turnstile loads an external script; the tests set the token directly instead of rendering it.
  TestBed.overrideComponent(ReportDialog, { set: { imports: [] , template: '' } });
  const cmp = TestBed.createComponent(ReportDialog).componentInstance as unknown as Internals;
  return { cmp, close, http: TestBed.inject(HttpTestingController) };
}

describe('ReportDialog', () => {
  it('sends the report with the Turnstile token and closes', async () => {
    const { cmp, close, http } = setup();
    cmp.form.patchValue({ reason: 'malware', details: 'Ships a crypto miner.', contact: '' });
    cmp.captchaToken.set('turnstile-token');
    const done = cmp.send();
    const req = http.expectOne('/api/repos/app/reports');
    expect(req.request.headers.get('x-captcha-response')).toBe('turnstile-token');
    expect(req.request.body).toEqual({ reason: 'malware', details: 'Ships a crypto miner.', contact: null });
    req.flush({ id: 'r1' }, { status: 201, statusText: 'Created' });
    await done;
    expect(close).toHaveBeenCalledWith(true);
  });

  it('needs the Turnstile token and a valid form', async () => {
    const { cmp, http } = setup();
    cmp.form.patchValue({ reason: 'malware', details: 'Ships a crypto miner.' });
    await cmp.send();
    http.expectNone('/api/repos/app/reports');
  });

  it('explains rate limiting', async () => {
    const { cmp, http } = setup();
    cmp.form.patchValue({ reason: 'spam', details: 'Spam repo here.' });
    cmp.captchaToken.set('t');
    const done = cmp.send();
    http.expectOne('/api/repos/app/reports').flush({ error: 'rate_limited' }, { status: 429, statusText: 'Too Many Requests' });
    await done;
    expect(cmp.error()).toContain('Try again in a minute');
  });
});
