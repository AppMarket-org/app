import { TestBed } from '@angular/core/testing';
import { MarkdownEditor } from './markdown-editor';

async function setup(value: string, select: [number, number]) {
  const fixture = TestBed.createComponent(MarkdownEditor);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  await fixture.whenStable();
  const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  textarea.setSelectionRange(...select);
  const click = (label: string) => (fixture.nativeElement.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
  return { fixture, click, value: () => fixture.componentInstance.value() };
}

describe('MarkdownEditor', () => {
  it('wraps the selection, or a sample when nothing is selected', async () => {
    const e = await setup('Make this loud', [10, 14]);
    e.click('Bold');
    expect(e.value()).toBe('Make this **loud**');
    const empty = await setup('', [0, 0]);
    empty.click('Link');
    expect(empty.value()).toBe('[link text](https://)');
  });

  it('starts lines for lists, on a new line when the cursor is mid-line', async () => {
    const e = await setup('Steps\none\ntwo', [6, 13]);
    e.click('Numbered list');
    expect(e.value()).toBe('Steps\n1. one\n2. two');
    const mid = await setup('Todo', [4, 4]);
    mid.click('Task list');
    expect(mid.value()).toBe('Todo\n- [ ] Task');
  });

  it('submits on Cmd/Ctrl+Enter', async () => {
    const e = await setup('Done', [4, 4]);
    let submitted = 0;
    e.fixture.componentInstance.submit.subscribe(() => submitted++);
    e.fixture.nativeElement.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    expect(submitted).toBe(1);
  });
});
