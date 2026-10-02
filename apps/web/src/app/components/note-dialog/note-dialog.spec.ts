import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoteDialog, type NoteDialogData } from './note-dialog';

function setup(required: boolean) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { title: 'T', message: 'M', label: 'Note', confirm: 'OK', required } satisfies NoteDialogData },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(NoteDialog);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance as unknown as { note: { setValue(v: string): void }; confirm(): void }, close };
}

describe('NoteDialog', () => {
  it('will not close without a note when one is required', () => {
    const { cmp, close } = setup(true);
    cmp.confirm();
    expect(close).not.toHaveBeenCalled();
    cmp.note.setValue('  Add a README  ');
    cmp.confirm();
    expect(close).toHaveBeenCalledWith('Add a README');
  });

  it('closes with an empty string when a note is optional', () => {
    const { cmp, close } = setup(false);
    cmp.confirm();
    expect(close).toHaveBeenCalledWith('');
  });
});
