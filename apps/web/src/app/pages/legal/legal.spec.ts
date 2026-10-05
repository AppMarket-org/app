import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Legal } from './legal';

it('switches legal documents on the reused route and keeps draft status visible', async () => {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'legal/:page', component: Legal }])],
  });
  const harness = await RouterTestingHarness.create();
  const terms = await harness.navigateByUrl('/legal/terms', Legal);
  expect(harness.routeNativeElement?.textContent).toContain('Git hosting');
  const privacy = await harness.navigateByUrl('/legal/privacy', Legal);
  expect(privacy).toBe(terms);
  expect(harness.routeNativeElement?.textContent).toContain('Agent checkpoints');
  expect(
    harness.routeNativeElement?.querySelector('a[aria-current="page"]')?.textContent?.trim(),
  ).toBe('Privacy Policy');
  expect(TestBed.inject(Title).getTitle()).toBe('Privacy policy | appmarket.org');
  await harness.navigateByUrl('/legal/content-policy', Legal);
  expect(harness.routeNativeElement?.textContent).toContain('Copyright notices');
  await harness.navigateByUrl('/legal/developer-agreement', Legal);
  expect(harness.routeNativeElement?.textContent).toContain('10%');
  expect(harness.routeNativeElement?.textContent).not.toContain('Paid apps are not available yet');
  expect(harness.routeNativeElement?.textContent).toContain('Draft, not yet in effect');
});
