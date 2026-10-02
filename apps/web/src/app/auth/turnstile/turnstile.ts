import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID, afterNextRender, inject, output, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoad: Promise<void> | undefined;

function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/** Cloudflare Turnstile widget; emits a token for the API's captcha check (PRD R11). */
@Component({
  selector: 'app-turnstile',
  templateUrl: './turnstile.html',
  styleUrl: './turnstile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Turnstile implements OnDestroy {
  readonly token = output<string | null>();

  private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private widgetId?: string;

  constructor() {
    afterNextRender(async () => {
      await loadScript();
      this.widgetId = window.turnstile!.render(this.container().nativeElement, {
        sitekey: environment.turnstileSiteKey,
        callback: (t: string) => this.token.emit(t),
        'expired-callback': () => this.token.emit(null),
        'error-callback': () => this.token.emit(null),
      });
    });
  }

  ngOnDestroy(): void {
    if (this.isBrowser && this.widgetId) {
      window.turnstile?.remove(this.widgetId);
    }
  }
}
