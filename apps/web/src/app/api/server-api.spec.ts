import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { REQUEST, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { serverApiInterceptor, type ServerRequestContext } from './server-api';

describe('serverApiInterceptor', () => {
  it('sends /api requests over the binding with an absolute URL and the visitor cookie', async () => {
    const seen: Request[] = [];
    const context: ServerRequestContext = {
      apiFetch: async (request) => {
        seen.push(request);
        return Response.json({ name: 'App' });
      },
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverApiInterceptor])),
        { provide: REQUEST, useValue: new Request('https://appmarket.org/apps/app', { headers: { cookie: 'session=1' } }) },
        { provide: REQUEST_CONTEXT, useValue: context },
      ],
    });
    const body = await firstValueFrom(TestBed.inject(HttpClient).get<{ name: string }>('/api/repos/app'));
    expect(body.name).toBe('App');
    expect(seen[0]!.url).toBe('https://appmarket.org/api/repos/app');
    expect(seen[0]!.headers.get('cookie')).toBe('session=1');
  });

  it('turns API errors into HttpErrorResponse with the status', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([serverApiInterceptor])),
        { provide: REQUEST, useValue: new Request('https://appmarket.org/apps/x') },
        { provide: REQUEST_CONTEXT, useValue: { apiFetch: async () => Response.json({ error: 'not_found' }, { status: 404 }) } },
      ],
    });
    const error = await firstValueFrom(TestBed.inject(HttpClient).get('/api/repos/x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(404);
  });

  it('leaves requests alone in the browser', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([serverApiInterceptor])), provideHttpClientTesting()],
    });
    TestBed.inject(HttpClient).get('/api/me').subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/me').flush({});
  });
});
