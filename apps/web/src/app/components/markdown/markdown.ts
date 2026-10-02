import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { Marked } from 'marked';

const plain = new Marked({ gfm: true });

/** README headings sit under the page's own h1, so every level moves down one (h1 to h2 and so on). */
const shifted = new Marked({
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
  /** Move headings down a level (for READMEs inside a page that has its own h1). */
  readonly shiftHeadings = input(true);
  protected readonly html = computed(() =>
    // Images without alt text (often raw HTML in READMEs) are treated as decorative.
    ((this.shiftHeadings() ? shifted : plain).parse(this.source(), { async: false }) as string).replace(/<img(?![^>]*\balt=)/gi, '<img alt=""'),
  );
}
