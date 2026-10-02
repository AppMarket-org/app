import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { serverApiInterceptor } from './api/server-api';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // The interceptor only acts during SSR (see api/server-api.ts).
    provideHttpClient(withFetch(), withInterceptors([serverApiInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Server responses to GET requests are transferred to the browser, so hydration does not refetch.
    provideClientHydration(withEventReplay()),
  ],
};
