import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { Catalog } from '../../api/catalog';
import { Markdown } from '../markdown/markdown';

/** PRD G4: the generated repository map, loaded when opened. */
@Component({
  selector: 'app-repo-map',
  imports: [MatExpansionModule, MatProgressBarModule, Markdown],
  templateUrl: './repo-map.html',
  styleUrl: './repo-map.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoMap {
  /** The repo's path, `owner/slug`. */
  readonly path = input.required<string>();
  private readonly catalog = inject(Catalog);
  /** undefined: not loaded; null: none available. */
  protected readonly map = signal<string | null | undefined>(undefined);

  protected async load(): Promise<void> {
    if (this.map() !== undefined) return;
    this.map.set(await firstValueFrom(this.catalog.repoMap(this.path())).catch(() => null));
  }
}
