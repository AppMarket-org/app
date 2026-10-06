import { ChangeDetectionStrategy, Component, type ElementRef, input, model, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Markdown } from '../markdown/markdown';

interface Tool {
  icon: string;
  label: string;
  /** Wraps the selection (before/after), or starts each selected line with `line`. */
  before?: string;
  after?: string;
  line?: string;
  /** Placeholder text when nothing is selected. */
  sample: string;
}

const TOOLS: Tool[] = [
  { icon: 'title', label: 'Heading', line: '### ', sample: 'Heading' },
  { icon: 'format_bold', label: 'Bold', before: '**', after: '**', sample: 'bold text' },
  { icon: 'format_italic', label: 'Italic', before: '_', after: '_', sample: 'italic text' },
  { icon: 'format_quote', label: 'Quote', line: '> ', sample: 'Quote' },
  { icon: 'code', label: 'Code', before: '`', after: '`', sample: 'code' },
  { icon: 'link', label: 'Link', before: '[', after: '](https://)', sample: 'link text' },
  { icon: 'format_list_bulleted', label: 'Bulleted list', line: '- ', sample: 'Item' },
  { icon: 'format_list_numbered', label: 'Numbered list', line: '1. ', sample: 'Item' },
  { icon: 'checklist', label: 'Task list', line: '- [ ] ', sample: 'Task' },
];

/** Markdown with Write and Preview tabs and a small formatting toolbar (issues, comments). */
@Component({
  selector: 'app-markdown-editor',
  imports: [Markdown, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTabsModule, MatTooltipModule],
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditor {
  readonly value = model('');
  readonly label = input('Description');
  readonly placeholder = input('Type your description here…');
  readonly maxLength = input(20_000);
  readonly rows = input(10);
  /** Cmd/Ctrl+Enter. */
  readonly submit = output<void>();
  protected readonly tools = TOOLS;
  protected readonly tab = signal(0);
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('text');

  focus(): void {
    this.tab.set(0);
    setTimeout(() => this.textarea()?.nativeElement.focus());
  }

  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.submit.emit();
    }
  }

  protected apply(tool: Tool): void {
    const el = this.textarea()?.nativeElement;
    if (!el) return;
    const text = this.value();
    const [start, end] = [el.selectionStart, el.selectionEnd];
    const selected = text.slice(start, end) || tool.sample;
    let insert: string;
    let select: [number, number];
    if (tool.line) {
      // Line tools start a new line when the cursor is mid-line.
      const lead = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
      insert = lead + selected.split('\n').map((l, i) => (tool.line === '1. ' ? `${i + 1}. ` : tool.line) + l).join('\n');
      select = [start + insert.length - selected.split('\n').at(-1)!.length, start + insert.length];
    } else {
      insert = `${tool.before}${selected}${tool.after}`;
      select = [start + tool.before!.length, start + tool.before!.length + selected.length];
    }
    this.value.set(text.slice(0, start) + insert + text.slice(end));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(...select);
    });
  }
}
