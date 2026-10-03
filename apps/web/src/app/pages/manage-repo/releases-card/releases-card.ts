import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RELEASE_LIMITS, RELEASE_PLATFORMS, type Release, type ReleasePlatform } from '@appmarket/shared';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { Developer } from '../../../api/developer';
import { fileSize, sha256Hex } from '../../../components/file-size';

const ERRORS: Record<string, string> = {
  checksum_mismatch: 'The file changed during upload (checksum mismatch). Try again.',
  tag_not_found: 'That tag is not in the repository. Push it first.',
  exists: 'A file with that name already exists for this tag and platform.',
  too_large: `Files can be at most ${fileSize(RELEASE_LIMITS.maxBytes)}.`,
  too_many: `A version can have at most ${RELEASE_LIMITS.maxPerVersion} files.`,
  invalid: 'Check the tag and the file name (letters, digits, spaces, ".", "_", "-").',
};

/** PRD R13/R16: upload release binaries for a tag; the SHA-256 is computed here and verified by the API. */
@Component({
  selector: 'app-releases-card',
  imports: [ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule],
  templateUrl: './releases-card.html',
  styleUrl: './releases-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleasesCard {
  /** The repo's path, `owner/slug`. */
  readonly path = input.required<string>();
  readonly suggestedTag = input<string | null>(null);

  private readonly api = inject(Developer);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly platforms = Object.entries(RELEASE_PLATFORMS).map(([key, name]) => ({ key: key as ReleasePlatform, name }));
  protected readonly platformName = (p: ReleasePlatform) => RELEASE_PLATFORMS[p];
  protected readonly size = fileSize;
  protected readonly maxSize = fileSize(RELEASE_LIMITS.maxBytes);
  protected readonly releases = signal<Release[]>([]);
  protected readonly file = signal<File | null>(null);
  /** null when idle; 0-100 while uploading; -1 while computing the checksum. */
  protected readonly progress = signal<number | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    tag: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)]],
    platform: ['android' as ReleasePlatform, Validators.required],
  });

  ngOnInit(): void {
    if (this.suggestedTag()) this.form.controls.tag.setValue(this.suggestedTag()!);
    void this.load();
  }

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file && file.size > RELEASE_LIMITS.maxBytes) {
      this.snackBar.open(ERRORS['too_large']!, 'OK', { duration: 5000 });
      return;
    }
    this.file.set(file);
  }

  protected async upload(): Promise<void> {
    const file = this.file();
    this.form.markAllAsTouched();
    if (!file || this.form.invalid || this.progress() !== null) return;
    try {
      this.progress.set(-1);
      const sha256 = await sha256Hex(file);
      const { tag, platform } = this.form.getRawValue();
      this.progress.set(0);
      await lastValueFrom(
        this.api.uploadRelease(this.path(), file, { tag: tag.trim(), platform, sha256 }).pipe(
          tap((event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) this.progress.set(Math.round((100 * event.loaded) / event.total));
          }),
        ),
      );
      this.file.set(null);
      this.snackBar.open(`${file.name} uploaded`, undefined, { duration: 3000 });
      await this.load();
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null)?.error : undefined;
      this.snackBar.open(ERRORS[code ?? ''] ?? 'Upload failed. Please try again.', 'OK', { duration: 6000 });
    } finally {
      this.progress.set(null);
    }
  }

  protected async remove(release: Release): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteRelease(this.path(), release.id));
      this.releases.update((list) => list.filter((r) => r.id !== release.id));
    } catch {
      this.snackBar.open('Could not delete the file.', 'OK', { duration: 5000 });
    }
  }

  private async load(): Promise<void> {
    try {
      this.releases.set(await firstValueFrom(this.api.releases(this.path())));
    } catch {
      this.releases.set([]);
    }
  }
}
