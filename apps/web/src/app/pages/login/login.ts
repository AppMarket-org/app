import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute } from '@angular/router';
import { Auth, type Provider } from '../../auth/auth';
import { Turnstile } from '../../auth/turnstile/turnstile';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatCardModule, MatProgressBarModule, Turnstile],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly next = inject(ActivatedRoute).snapshot.queryParamMap.get('next') ?? '/dashboard';

  protected readonly captchaToken = signal<string | null>(null);
  protected readonly pending = signal<Provider | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(Seo).set({ title: 'Sign in', description: 'Sign in to appmarket.org with Google or GitHub.', path: '/login', noindex: true });
  }

  protected async signIn(provider: Provider): Promise<void> {
    const token = this.captchaToken();
    if (!token) return;
    this.pending.set(provider);
    this.error.set(null);
    try {
      // Only same-site paths are allowed as the post-login destination.
      await this.auth.signIn(provider, token, this.next.startsWith('/') && !this.next.startsWith('//') ? this.next : '/dashboard');
    } catch {
      this.pending.set(null);
      this.error.set('Sign-in failed. Please try again.');
    }
  }
}
