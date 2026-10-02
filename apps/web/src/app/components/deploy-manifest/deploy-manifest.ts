import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import type { DeployManifest as Manifest, ManifestResourceType } from '@appmarket/shared';

const RESOURCE_LABELS: Record<ManifestResourceType, string> = {
  kv: 'KV namespace',
  d1: 'D1 database',
  r2: 'R2 bucket',
  queue: 'Queue',
  'durable-object': 'Durable Object',
  vectorize: 'Vectorize index',
  hyperdrive: 'Hyperdrive config',
  'workers-ai': 'Workers AI',
  workflow: 'Workflow',
  service: 'Service binding',
  'analytics-engine': 'Analytics Engine dataset',
  browser: 'Browser Rendering',
  images: 'Images',
  container: 'Container',
  assets: 'Static assets',
};

/** PRD D3: what deploying an app creates in the buyer's Cloudflare account. */
@Component({
  selector: 'app-deploy-manifest',
  imports: [MatChipsModule, MatIconModule, MatListModule],
  templateUrl: './deploy-manifest.html',
  styleUrl: './deploy-manifest.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeployManifest {
  readonly manifest = input.required<Manifest>();
  protected readonly label = (t: ManifestResourceType) => RESOURCE_LABELS[t];
  protected readonly empty = computed(() => {
    const m = this.manifest();
    return m.resources.length === 0 && m.envVars.length === 0 && m.secrets.length === 0;
  });
}
