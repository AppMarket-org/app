import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface NoteDialogData {
  title: string;
  message: string;
  label: string;
  confirm: string;
  /** When true the note cannot be empty. */
  required: boolean;
  danger?: boolean;
}

/** Confirmation with a note (moderation decisions). Closes with the note, '' for none, or undefined on cancel. */
@Component({
  selector: 'app-note-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  templateUrl: './note-dialog.html',
  styleUrl: './note-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteDialog {
  protected readonly data = inject<NoteDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<NoteDialog, string>>(MatDialogRef);
  protected readonly note = new FormControl('', { nonNullable: true, validators: this.data.required ? [Validators.required, Validators.maxLength(500)] : [Validators.maxLength(500)] });

  protected confirm(): void {
    this.note.markAsTouched();
    if (this.note.invalid) return;
    this.ref.close(this.note.value.trim());
  }
}
