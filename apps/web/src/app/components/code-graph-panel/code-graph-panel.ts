import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CodeGraphApi, type CodeGraphFile } from '../../api/code-graph';

/** Files the code graph indexes: TypeScript/JavaScript and Python. */
export const GRAPHED_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;

export const SYMBOL_ICONS: Record<string, string> = { function: 'function', class: 'category', interface: 'data_object', type: 'data_object', enum: 'list', const: 'tag', variable: 'tag' };

/**
 * #240 for people: beside an open file, what it defines (jump to the line), what it imports, what
 * imports it, and what a change to it can affect. From the default branch's code graph.
 */
@Component({
  selector: 'app-code-graph-panel',
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  templateUrl: './code-graph-panel.html',
  styleUrl: './code-graph-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeGraphPanel {
  private readonly api = inject(CodeGraphApi);
  /** `owner/slug`. */
  readonly repo = input.required<string>();
  readonly file = input.required<string>();
  /** The branch shown in the code view: the graph covers the default branch only. */
  readonly ref = input<string | null>(null);
  readonly openFile = output<string>();
  readonly openLine = output<number>();
  /** undefined while loading; null when the file is not in the graph. */
  protected readonly data = signal<CodeGraphFile | null | undefined>(undefined);
  protected readonly icons = SYMBOL_ICONS;
  protected readonly otherBranch = computed(() => {
    const d = this.data();
    const ref = this.ref();
    return !!d && !!ref && ref !== d.branch;
  });

  constructor() {
    effect(() => {
      const repo = this.repo();
      const file = this.file();
      untracked(() => void this.load(repo, file));
    });
  }

  private async load(repo: string, file: string): Promise<void> {
    this.data.set(undefined);
    const d = await firstValueFrom(this.api.file(repo, file)).catch(() => null);
    this.data.set(d && (d.symbols.length || d.imports.length || d.importedBy.length) ? d : null);
  }

  protected readonly name = (path: string) => path.split('/').pop() ?? path;
}
