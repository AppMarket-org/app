import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

interface RuleResult {
  id: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  status: 'pass' | 'fail' | 'pending';
  details: string[];
}

const ICON = { pass: 'check_circle', fail: 'cancel', pending: 'schedule' } as const;

/** #68 (G3): pass/fail per versioned conformance rule, for the published version or the newest push. */
@Component({
  selector: 'app-conformance',
  imports: [MatExpansionModule, MatIconModule],
  templateUrl: './conformance.html',
  styleUrl: './conformance.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conformance {
  readonly path = input.required<string>();
  /** The newest pushed commit (dashboard) instead of the published version. */
  readonly latest = input(false);
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly data = signal<{ version: number; commit: string | null; results: RuleResult[] } | null>(null);
  protected readonly icon = ICON;
  protected readonly passed = computed(() => this.data()?.results.filter((r) => r.status === 'pass').length ?? 0);
  protected readonly blocking = computed(() => this.data()?.results.filter((r) => r.severity === 'error' && r.status === 'fail').length ?? 0);
  protected readonly label = (r: RuleResult) => (r.severity === 'info' ? 'info' : r.severity);

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;
    this.data.set(await firstValueFrom(this.http.get<{ version: number; commit: string | null; results: RuleResult[] }>(`/api/repos/${this.path()}/conformance`, { params: this.latest() ? { commit: 'latest' } : {} })).catch(() => null));
  }
}
