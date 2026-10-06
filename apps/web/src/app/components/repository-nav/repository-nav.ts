import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-repository-nav',
  imports: [MatTabsModule, MatIconModule, RouterLink],
  template: `
    <nav mat-tab-nav-bar [tabPanel]="panel" [mat-stretch-tabs]="false" aria-label="Repository navigation">
      @for (tab of tabs(); track tab.id) {
        <a mat-tab-link [routerLink]="tab.link" [queryParams]="tab.query"
          [active]="active() === tab.id" [attr.aria-current]="active() === tab.id ? 'page' : null">
          <mat-icon aria-hidden="true">{{ tab.icon }}</mat-icon>{{ tab.label }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #panel />
  `,
  styles: `
    :host { display: block; margin-bottom: 1.5rem; }
    nav { --mat-tab-header-active-label-text-color: var(--mat-sys-on-surface); --mat-tab-header-active-indicator-color: var(--mat-sys-primary); --mat-tab-header-label-text-size: 0.875rem; }
    mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; margin-right: 0.5rem; }
    @media (max-width: 48rem) { mat-icon { display: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryNav {
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  readonly active = input('code');
  readonly managed = input(true);
  protected readonly tabs = computed(() => {
    const root = ['/dashboard/repos', this.owner(), this.slug()];
    const publicRoot = ['/', this.owner(), this.slug()];
    return [
      { id: 'code', label: 'Code', icon: 'code', link: this.managed() ? root : [...publicRoot, 'code'], query: {} },
      { id: 'pulls', label: 'Pull requests', icon: 'call_split', link: [...publicRoot, 'pulls'], query: {} },
      ...(this.managed() ? [
        { id: 'agents', label: 'Agents', icon: 'smart_toy', link: [...root, 'agents'], query: {} },
        { id: 'checkpoints', label: 'Checkpoints', icon: 'history_edu', link: [...root, 'checkpoints'], query: {} },
        { id: 'deployments', label: 'Deployments', icon: 'cloud_upload', link: root, query: { tab: 'deployments' } },
        { id: 'marketplace', label: 'Marketplace', icon: 'storefront', link: root, query: { tab: 'marketplace' } },
        { id: 'settings', label: 'Settings', icon: 'settings', link: root, query: { tab: 'settings' } },
      ] : []),
    ];
  });
}
