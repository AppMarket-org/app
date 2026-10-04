import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AVATAR_LIMITS, type Owner } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { OwnersApi } from '../../api/owners';
import { Avatar } from '../avatar/avatar';
import { cropSquare } from '../avatar/crop';

const MB = AVATAR_LIMITS.maxBytes / 1024 / 1024;

/** #140: upload, replace or remove a user's picture or an organization's logo. */
@Component({
  selector: 'app-avatar-editor',
  imports: [Avatar, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './avatar-editor.html',
  styleUrl: './avatar-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarEditor {
  readonly owner = input.required<Owner>();
  /** Whether the picture is an upload (removable) rather than the sign-in picture or an initial. */
  readonly uploaded = computed(() => this.owner().avatarUrl?.startsWith('/api/media/avatars/') ?? false);
  readonly changed = output<Owner>();

  private readonly api = inject(OwnersApi);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly accept = AVATAR_LIMITS.types.join(',');
  protected readonly maxMb = MB;

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    if (!(AVATAR_LIMITS.types as readonly string[]).includes(file.type)) return this.error.set('Use a PNG, JPEG or WebP image.');
    if (file.size > AVATAR_LIMITS.maxBytes) return this.error.set(`That file is larger than ${MB} MB.`);
    await this.run(async () => {
      const square = await cropSquare(file);
      return firstValueFrom(this.api.setAvatar(square, this.org()));
    }, 'Picture updated');
  }

  protected remove(): Promise<void> {
    return this.run(() => firstValueFrom(this.api.removeAvatar(this.org())), 'Picture removed');
  }

  private org(): string | undefined {
    return this.owner().kind === 'org' ? this.owner().handle : undefined;
  }

  private async run(work: () => Promise<{ owner: Owner }>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      this.changed.emit((await work()).owner);
      this.snackBar.open(done, undefined, { duration: 2500 });
    } catch (error) {
      const code = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null)?.error : undefined;
      this.error.set(
        code === 'too_large' ? `That file is larger than ${MB} MB.` : code === 'unsupported_image' ? 'Use a PNG, JPEG or WebP image.' : error instanceof HttpErrorResponse ? 'Could not save the picture. Try again.' : 'Could not read that image.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
