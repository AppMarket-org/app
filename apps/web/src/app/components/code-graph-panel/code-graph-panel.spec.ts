import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CodeGraphApi, type CodeGraphFile } from '../../api/code-graph';
import { CodeGraphPanel, GRAPHED_FILE } from './code-graph-panel';

const data: CodeGraphFile = {
  commit: 'c'.repeat(40),
  branch: 'main',
  path: 'src/game.ts',
  symbols: [{ path: 'src/game.ts', name: 'newBoard', kind: 'function', line: 12, exported: true }],
  imports: ['src/board.ts'],
  importedBy: ['src/main.ts', 'test/game.test.ts'],
  impact: [
    { path: 'src/main.ts', depth: 1, via: 'src/game.ts' },
    { path: 'src/app.ts', depth: 2, via: 'src/main.ts' },
  ],
};

describe('CodeGraphPanel', () => {
  it('lists what the file defines, imports and is imported by, and what a change can affect; clicks open lines and files', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CodeGraphApi, useValue: { file: vi.fn(() => of(data)) } }] });
    const fixture = TestBed.createComponent(CodeGraphPanel);
    fixture.componentRef.setInput('repo', 'dev/app');
    fixture.componentRef.setInput('file', 'src/game.ts');
    const lines: number[] = [];
    const files: string[] = [];
    fixture.componentInstance.openLine.subscribe((l) => lines.push(l));
    fixture.componentInstance.openFile.subscribe((f) => files.push(f));
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('h3')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Defined here 1', 'Imports 1', 'Imported by 2', 'A change here can affect 2']);
    expect(el.textContent).toContain('2 steps away, via main.ts');
    (el.querySelector('[aria-label="Defined in this file"] button') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Files this file imports"] button') as HTMLButtonElement).click();
    expect(lines).toEqual([12]);
    expect(files).toEqual(['src/board.ts']);
  });

  it('knows which files the graph covers', () => {
    expect(['a.ts', 'b.tsx', 'c.mjs', 'd.py'].every((f) => GRAPHED_FILE.test(f))).toBe(true);
    expect(['README.md', 'x.css', 'y.d.json'].some((f) => GRAPHED_FILE.test(f))).toBe(false);
  });
});
