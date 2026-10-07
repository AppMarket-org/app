import { TestBed } from '@angular/core/testing';
import { IosApp } from './ios-app';

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(IosApp);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('IosApp (#43)', () => {
  it('links to the App Store and the TestFlight beta in a new tab', () => {
    const el = render({ name: 'BombFind', appStoreUrl: 'https://apps.apple.com/us/app/bombfind/id1234567890', testflightUrl: 'https://testflight.apple.com/join/AbCd1234' });
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])).toEqual([
      ['phone_iphoneGet it on the App Store', 'https://apps.apple.com/us/app/bombfind/id1234567890', '_blank', 'noopener'],
      ['scienceJoin the TestFlight beta', 'https://testflight.apple.com/join/AbCd1234', '_blank', 'noopener'],
    ]);
    expect(el.textContent).toContain('The beta needs the free TestFlight app.');
  });

  it('shows only the links it has', () => {
    const el = render({ name: 'BombFind', testflightUrl: 'https://testflight.apple.com/join/AbCd1234' });
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://testflight.apple.com/join/AbCd1234']);
  });
});
