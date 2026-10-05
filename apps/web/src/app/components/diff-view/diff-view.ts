import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { PullComment } from '@appmarket/shared';
import type { DiffHunk } from '../../api/pulls';
import { languageFor } from '../../pages/code/languages';
import { Markdown } from '../markdown/markdown';

interface Token {
  content: string;
  color?: string;
}

export interface DiffRow {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  oldLine: number | null;
  newLine: number | null;
  text: string;
  tokens: Token[] | null;
}

/** Hunks → rows with old and new line numbers (pure, for tests). */
export function diffRows(hunks: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const h of hunks) {
    rows.push({ kind: 'hunk', oldLine: null, newLine: null, text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, tokens: null });
    let o = h.oldStart;
    let n = h.newStart;
    for (const line of h.lines) {
      const text = line.slice(1);
      if (line.startsWith('+')) rows.push({ kind: 'add', oldLine: null, newLine: n++, text, tokens: null });
      else if (line.startsWith('-')) rows.push({ kind: 'del', oldLine: o++, newLine: null, text, tokens: null });
      else rows.push({ kind: 'ctx', oldLine: o++, newLine: n++, text, tokens: null });
    }
  }
  return rows;
}

/** Where a comment on a row goes: deleted lines are on the old side, others on the new side. */
export const anchorOf = (row: DiffRow): { side: 'old' | 'new'; line: number } | null =>
  row.kind === 'del' ? { side: 'old', line: row.oldLine! } : row.newLine ? { side: 'new', line: row.newLine } : null;

/**
 * #259: one file of a pull request's diff, highlighted with Shiki (tokens, not HTML), with old and
 * new line numbers and line comments under their lines.
 */
@Component({
  selector: 'app-diff-view',
  imports: [FormsModule, Markdown, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffView {
  readonly path = input.required<string>();
  readonly hunks = input.required<DiffHunk[]>();
  readonly comments = input<PullComment[]>([]);
  readonly canComment = input(false);
  readonly addComment = output<{ path: string; line: number; side: 'old' | 'new'; body: string }>();

  protected readonly rows = signal<DiffRow[]>([]);
  protected readonly open = signal<string | null>(null);
  protected draft = '';

  protected readonly byLine = computed(() => {
    const map = new Map<string, PullComment[]>();
    for (const c of this.comments()) {
      if (c.path !== this.path() || !c.line || !c.side) continue;
      const key = `${c.side}:${c.line}`;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  });

  constructor() {
    effect(() => {
      const rows = diffRows(this.hunks());
      this.rows.set(rows);
      void this.highlight(rows, this.path());
    });
  }

  protected key(row: DiffRow): string | null {
    const a = anchorOf(row);
    return a ? `${a.side}:${a.line}` : null;
  }

  protected start(row: DiffRow): void {
    if (!this.canComment()) return;
    this.draft = '';
    this.open.set(this.key(row));
  }

  protected send(row: DiffRow): void {
    const a = anchorOf(row);
    if (!a || !this.draft.trim()) return;
    this.addComment.emit({ path: this.path(), ...a, body: this.draft.trim() });
    this.open.set(null);
  }

  private async highlight(rows: DiffRow[], path: string): Promise<void> {
    const lang = languageFor(path);
    if (lang === 'text' || rows.length > 3000) return;
    try {
      const { codeToTokens } = await import('shiki');
      const code = rows.filter((r) => r.kind !== 'hunk').map((r) => r.text);
      const { tokens } = await codeToTokens(code.join('\n'), { lang: lang as never, theme: 'github-light' });
      let i = 0;
      this.rows.set(rows.map((r) => (r.kind === 'hunk' ? r : { ...r, tokens: (tokens[i++] ?? []).map((t) => ({ content: t.content, color: t.color })) })));
    } catch {
      // Unknown language: plain text.
    }
  }
}
