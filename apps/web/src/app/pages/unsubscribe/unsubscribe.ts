import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';

/**
 * #230: the page behind an email's "Stop these emails" link. Unsubscribing takes a click (mail
 * scanners open links, and must not unsubscribe anyone); mail apps use the one-click header instead.
 */
@Component({
  selector: 'app-unsubscribe',
  imports: [MatButtonModule, MatCardModule, MatIconModule, RouterLink],
  templateUrl: './unsubscribe.html',
  styleUrl: './unsubscribe.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnsubscribePage {
  private readonly http = inject(HttpClient);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  /** What the link turns off. */
  protected readonly topic = ({ pulls: 'Pull request emails', issues: 'Issue emails' } as Record<string, string>)[this.query.get('t') ?? ''] ?? 'Security notice emails';
  protected readonly state = signal<'ready' | 'working' | 'done' | 'invalid'>(this.query.get('u') && this.query.get('s') ? 'ready' : 'invalid');

  constructor() {
    inject(Seo).set({ title: 'Unsubscribe', description: 'Stop email from appmarket.org.', path: '/email/unsubscribe', noindex: true });
  }

  protected async unsubscribe(): Promise<void> {
    this.state.set('working');
    const params = { u: this.query.get('u') ?? '', t: this.query.get('t') ?? '', s: this.query.get('s') ?? '' };
    try {
      await firstValueFrom(this.http.post('/api/email/unsubscribe', null, { params }));
      this.state.set('done');
    } catch {
      this.state.set('invalid');
    }
  }
}
