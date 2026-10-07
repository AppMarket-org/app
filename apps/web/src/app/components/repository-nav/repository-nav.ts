import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-repository-nav',
  imports: [MatTabsModule, MatIconModule, RouterLink, MatFormFieldModule, MatSelectModule],
  template: `
    <nav mat-tab-nav-bar class="desktop-nav" [tabPanel]="panel" [mat-stretch-tabs]="false" aria-label="Repository navigation">
      @for (tab of tabs(); track tab.id) {
        <a mat-tab-link [routerLink]="tab.link" [queryParams]="tab.query"
          [active]="active() === tab.id" [attr.aria-current]="active() === tab.id ? 'page' : null">
          <mat-icon aria-hidden="true">{{ tab.icon }}</mat-icon>{{ tab.label }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #panel />
    <mat-form-field class="mobile-picker" appearance="outline" subscriptSizing="dynamic">
      <mat-label>Repository section</mat-label>
      <mat-select [value]="active()" (selectionChange)="open($event.value)">
        @for (tab of tabs(); track tab.id) { <mat-option [value]="tab.id">{{ tab.label }}</mat-option> }
      </mat-select>
    </mat-form-field>
  `,
  styles: `
    :host { display: block; margin-bottom: var(--app-content-gap); }
    nav { --mat-tab-header-active-label-text-color: var(--mat-sys-on-surface); --mat-tab-header-active-indicator-color: var(--mat-sys-primary); --mat-tab-label-text-size: 0.875rem; }
    mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; margin-right: 0.5rem; }
    .mobile-picker { display: none; width: 100%; }
    @media (max-width: 48rem) { .desktop-nav { display: none; } .mobile-picker { display: block; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryNav {
  private readonly router = inject(Router);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  readonly active = input('code');
  readonly managed = input(true);
  protected open(id: string): void {
    const tab = this.tabs().find((tab) => tab.id === id);
    if (tab) void this.router.navigate(tab.link, { queryParams: tab.query });
  }
  protected readonly tabs = computed(() => {
    const root = ['/dashboard/repos', this.owner(), this.slug()];
    const publicRoot = ['/', this.owner(), this.slug()];
    return [
      { id: 'code', label: 'Code', icon: 'code', link: this.managed() ? root : [...publicRoot, 'code'], query: {} },
      { id: 'issues', label: 'Issues', icon: 'confirmation_number', link: [...publicRoot, 'issues'], query: {} },
      { id: 'pulls', label: 'Pull requests', icon: 'call_split', link: [...publicRoot, 'pulls'], query: {} },
      ...(this.managed() ? [
        { id: 'graph', label: 'Graph', icon: 'hub', link: [...publicRoot, 'graph'], query: {} },
        { id: 'agents', label: 'Agents', icon: 'smart_toy', link: [...root, 'agents'], query: {} },
        { id: 'checkpoints', label: 'Checkpoints', icon: 'history_edu', link: [...root, 'checkpoints'], query: {} },
        { id: 'memory', label: 'Memory', icon: 'psychology', link: [...root, 'memory'], query: {} },
        { id: 'deployments', label: 'Deployments', icon: 'cloud_upload', link: root, query: { tab: 'deployments' } },
        { id: 'marketplace', label: 'Marketplace', icon: 'storefront', link: root, query: { tab: 'marketplace' } },
        { id: 'settings', label: 'Settings', icon: 'settings', link: root, query: { tab: 'settings' } },
      ] : []),
    ];
  });
}
