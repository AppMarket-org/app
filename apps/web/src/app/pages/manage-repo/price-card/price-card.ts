import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PLATFORM_FEE_RATE, PRICE_LIMITS, type PayoutAccount, type Repo, type Sale, platformFeeCents } from '@appmarket/shared';
import { DatePipe } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { firstValueFrom } from 'rxjs';

const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['SE', 'Sweden'], ['DK', 'Denmark'], ['NO', 'Norway'], ['FI', 'Finland'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['BE', 'Belgium'], ['PT', 'Portugal'], ['PL', 'Poland'],
  ['AU', 'Australia'], ['NZ', 'New Zealand'], ['JP', 'Japan'], ['SG', 'Singapore'],
];

/**
 * #211/#212: sell the app. Payouts go to the repo owner's (user or org) Stripe Express account;
 * a price can be set once that account can receive transfers. appmarket.org keeps 10%.
 */
@Component({
  selector: 'app-price-card',
  imports: [DatePipe, MatListModule, FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule],
  templateUrl: './price-card.html',
  styleUrl: './price-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceCard {
  readonly repo = input.required<Repo>();
  readonly changed = output<Repo>();
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly countries = COUNTRIES;
  protected readonly feePercent = PLATFORM_FEE_RATE * 100;
  protected readonly limits = PRICE_LIMITS;
  protected readonly account = signal<(PayoutAccount & { enabled: boolean }) | null>(null);
  protected readonly busy = signal(false);
  /** #214 */
  protected readonly sales = signal<{ items: Sale[]; totals: { sales: number; grossCents: number; netCents: number } } | null>(null);
  protected readonly money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  protected readonly country = signal('US');
  protected readonly paid = signal(false);
  protected readonly dollars = signal('');
  protected readonly cents = computed(() => Math.round(Number(this.dollars()) * 100));
  protected readonly validPrice = computed(() => !this.paid() || (Number.isFinite(this.cents()) && this.cents() >= PRICE_LIMITS.minCents && this.cents() <= PRICE_LIMITS.maxCents));
  protected readonly youGet = computed(() => (this.cents() - platformFeeCents(this.cents())) / 100);

  ngOnInit(): void {
    const r = this.repo();
    this.paid.set(r.priceCents > 0);
    this.dollars.set(r.priceCents > 0 ? (r.priceCents / 100).toFixed(2) : '9.00');
    void this.load();
  }

  protected async connect(): Promise<void> {
    this.busy.set(true);
    try {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>(`/api/owners/${this.repo().owner.handle}/payouts/onboard`, { country: this.country(), returnTo: `/dashboard/repos/${this.repo().fullName}` }));
      window.location.assign(url);
    } catch (error) {
      this.fail(error, 'Could not start payout setup.');
      this.busy.set(false);
    }
  }

  protected async dashboard(): Promise<void> {
    try {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>(`/api/owners/${this.repo().owner.handle}/payouts/dashboard`, {}));
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      this.fail(error, 'Could not open the Stripe dashboard.');
    }
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      const repo = await firstValueFrom(this.http.put<Repo>(`/api/repos/${this.repo().fullName}/price`, { priceCents: this.paid() ? this.cents() : 0 }));
      this.changed.emit(repo);
      this.snackBar.open(repo.priceCents > 0 ? `Price set to $${(repo.priceCents / 100).toFixed(2)}` : 'The app is free', undefined, { duration: 3000 });
    } catch (error) {
      this.fail(error, 'Could not save the price.');
    } finally {
      this.busy.set(false);
    }
  }

  private fail(error: unknown, fallback: string): void {
    const message = error instanceof HttpErrorResponse ? (error.error as { message?: string } | null)?.message : undefined;
    this.snackBar.open(message ?? fallback, 'OK', { duration: 6000 });
  }

  private async load(): Promise<void> {
    this.account.set(await firstValueFrom(this.http.get<PayoutAccount & { enabled: boolean }>(`/api/owners/${this.repo().owner.handle}/payouts`)).catch(() => null));
    this.sales.set(await firstValueFrom(this.http.get<{ items: Sale[]; totals: { sales: number; grossCents: number; netCents: number } }>(`/api/repos/${this.repo().fullName}/sales`)).catch(() => null));
  }
}
