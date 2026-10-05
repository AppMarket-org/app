import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';

export interface FileNode {
  name: string;
  path: string;
  type: 'tree' | 'blob' | 'link';
  children?: FileNode[];
  expanded?: boolean;
  loading?: boolean;
  error?: boolean;
}
@Component({
  selector: 'app-code-explorer',
  imports: [
    NgTemplateOutlet,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
  ],
  templateUrl: './explorer.html',
  styleUrl: './explorer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeExplorer {
  readonly busy = input(false);
  readonly nodes = input<FileNode[]>([]);
  readonly selected = input<string | null>(null);
  readonly ref = input('');
  readonly branches = input<string[]>([]);
  readonly files = input<string[]>([]);
  readonly indexing = input(false);
  readonly indexError = input(false);
  readonly complete = input(true);
  readonly selectFile = output<string>();
  readonly selectBranch = output<string>();
  readonly toggle = output<FileNode>();
  readonly search = output<void>();
  protected readonly term = signal('');
  protected readonly matches = computed(() => {
    const term = this.term().trim().toLowerCase();
    return this.files()
      .filter((path) => path.toLowerCase().includes(term))
      .slice(0, 60);
  });
  protected open(path: string): void {
    this.selectFile.emit(path);
    this.term.set('');
  }
}
