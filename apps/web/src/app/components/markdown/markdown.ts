import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { Marked } from 'marked';

/** README headings sit under the page's own h1, so every level moves down one (h1 to h2 and so on). */
const markdown = new Marked({
  gfm: true,
  walkTokens: (token) => {
    if (token.type === 'heading') token.depth = Math.min(token.depth + 1, 6);
  },
});

/**
 * Renders Markdown (for example a README). The HTML is bound with [innerHTML], so Angular's
 * sanitizer strips scripts, event handlers and javascript: URLs before it reaches the page.
 */
@Component({
  selector: 'app-markdown',
  templateUrl: './markdown.html',
  styleUrl: './markdown.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Styles must reach the injected HTML; they stay scoped under the .markdown class.
  encapsulation: ViewEncapsulation.None,
})
export class Markdown {
  readonly source = input.required<string>();
  protected readonly html = computed(() => markdown.parse(this.source(), { async: false }) as string);
}
