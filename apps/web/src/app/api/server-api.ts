import { HttpErrorResponse, HttpHeaders, type HttpEvent, type HttpInterceptorFn, type HttpRequest, HttpResponse } from '@angular/common/http';
import { REQUEST, REQUEST_CONTEXT, inject } from '@angular/core';
import { from } from 'rxjs';

/** Passed by the Worker entry (server.ts) as Angular's request context. */
export interface ServerRequestContext {
  /** Sends a request to the API Worker over the service binding (no public hop). */
  apiFetch?: (request: Request) => Promise<Response>;
}

/**
 * Effective on the server only. Makes relative `/api/*` requests absolute, forwards the visitor's cookie so owners
 * can render their own drafts, and, on Workers, routes them over the API service binding.
 * Under `ng serve` there is no binding, so they go to the dev server, which proxies /api.
 */
export const serverApiInterceptor: HttpInterceptorFn = (req, next) => {
  // In the browser there is no incoming request: relative URLs already reach the API.
  const incoming = inject(REQUEST, { optional: true });
  if (!incoming || !req.url.startsWith('/api/')) return next(req);
  const context = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;
  const origin = new URL(incoming.url).origin;
  const cookie = incoming.headers.get('cookie');
  const absolute = req.clone({ url: origin + req.url, setHeaders: cookie ? { cookie } : {} });
  return context?.apiFetch ? from(send(absolute, context.apiFetch)) : next(absolute);
};

async function send(req: HttpRequest<unknown>, apiFetch: (request: Request) => Promise<Response>): Promise<HttpEvent<unknown>> {
  const headers = new Headers();
  req.headers.keys().forEach((name) => headers.set(name, req.headers.getAll(name)!.join(', ')));
  const body = req.serializeBody();
  if (body !== null && !headers.has('content-type')) {
    const type = req.detectContentTypeHeader();
    if (type) headers.set('content-type', type);
  }
  const response = await apiFetch(
    new Request(req.urlWithParams, { method: req.method, headers, body: body as BodyInit | null }),
  );
  const responseHeaders = new HttpHeaders(Object.fromEntries(response.headers.entries()));
  const text = await response.text();
  const parsed = req.responseType === 'json' ? (text ? JSON.parse(text) : null) : text;
  const init = { headers: responseHeaders, status: response.status, statusText: response.statusText, url: req.urlWithParams };
  if (!response.ok) throw new HttpErrorResponse({ ...init, error: parsed });
  return new HttpResponse({ ...init, body: parsed });
}


