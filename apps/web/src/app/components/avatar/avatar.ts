import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/** #140: an owner's picture, or their initial on a theme colour when there is none (or it fails to load). */
@Component({
  selector: 'app-avatar',
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--avatar-size]': "size() + 'rem'", '[class.square]': "kind() === 'org'" },
})
export class Avatar {
  readonly name = input.required<string>();
  readonly src = input<string | null | undefined>(null);
  /** Diameter in rem. */
  readonly size = input(2.5);
  /** Organizations get rounded squares, like GitHub. */
  readonly kind = input<'user' | 'org'>('user');
  /** Load right away (the profile page's main image) instead of lazily. */
  readonly eager = input(false);
  /** Decorative when the name is already shown next to it. */
  readonly decorative = input(false);

  protected readonly failed = signal(false);
  protected readonly initial = computed(() => (this.name().trim()[0] ?? '?').toUpperCase());
}
