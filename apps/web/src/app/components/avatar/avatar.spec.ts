import { TestBed } from '@angular/core/testing';
import { Avatar } from './avatar';

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(Avatar);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture;
}

describe('Avatar', () => {
  it('shows the picture, and the initial without one or when it fails to load', () => {
    const withPicture = render({ name: 'jane', src: '/api/media/avatars/x' });
    const img = (withPicture.nativeElement as HTMLElement).querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('jane');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    img.dispatchEvent(new Event('error'));
    withPicture.detectChanges();
    expect((withPicture.nativeElement as HTMLElement).textContent?.trim()).toBe('J');
    const initial = render({ name: 'Sam', decorative: true });
    expect((initial.nativeElement as HTMLElement).querySelector('.initial')!.getAttribute('aria-hidden')).toBe('true');
  });
});
