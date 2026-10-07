import { TestBed } from '@angular/core/testing';
import type { Repo } from '@appmarket/shared';
import { RepoForm, type RepoFormValue } from './repo-form';

interface Internals {
  form: { patchValue(v: object): void; getRawValue(): Record<string, unknown>; controls: Record<string, { getError(k: string): unknown }> };
  submit(): void;
}

function setup(inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(RepoForm);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const emitted: RepoFormValue[] = [];
  fixture.componentInstance.saved.subscribe((v) => emitted.push(v));
  return { fixture, cmp: fixture.componentInstance as unknown as Internals, emitted };
}

describe('RepoForm', () => {
  it('emits a clean value and normalises an empty license to null', () => {
    const { cmp, emitted } = setup();
    cmp.form.patchValue({ name: 'My App', summary: 'Does useful things', category: 'ai', license: '  ' });
    cmp.submit();
    expect(emitted).toEqual([{ name: 'My App', summary: 'Does useful things', description: '', category: 'ai', platforms: ['workers'], license: null, demoUrl: null, iosAppStoreUrl: null, iosTestflightUrl: null }]);
  });

  it('accepts a license with surrounding spaces, trimmed', () => {
    const { cmp, emitted } = setup();
    cmp.form.patchValue({ name: 'My App', summary: 'Does useful things', category: 'ai', license: ' MIT ' });
    cmp.submit();
    expect(emitted[0]?.license).toBe('MIT');
  });

  it('does not emit an invalid form', () => {
    const { cmp, emitted } = setup();
    cmp.form.patchValue({ name: 'x', summary: 'short', license: 'not a license!' });
    cmp.submit();
    expect(emitted).toEqual([]);
  });

  it('shows the iOS links only for iOS, validates them, and clears them when iOS is unticked (#43)', () => {
    const { fixture, cmp, emitted } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('App Store link');
    cmp.form.patchValue({ name: 'My App', summary: 'Does useful things', category: 'ai', platforms: ['workers', 'ios'], iosAppStoreUrl: 'https://example.com/app' });
    fixture.detectChanges();
    expect(el.textContent).toContain('App Store link');
    cmp.submit();
    expect(emitted).toEqual([]);
    cmp.form.patchValue({ iosAppStoreUrl: ' https://apps.apple.com/us/app/my-app/id1234567890 ', iosTestflightUrl: 'https://testflight.apple.com/join/AbCd1234' });
    cmp.submit();
    expect(emitted[0]).toMatchObject({ iosAppStoreUrl: 'https://apps.apple.com/us/app/my-app/id1234567890', iosTestflightUrl: 'https://testflight.apple.com/join/AbCd1234' });
    cmp.form.patchValue({ platforms: ['workers'] });
    cmp.submit();
    expect(emitted[1]).toMatchObject({ platforms: ['workers'], iosAppStoreUrl: null, iosTestflightUrl: null });
  });

  it('prefills from an existing repo and shows server field errors', () => {
    const initial = { name: 'Old', summary: 'Old summary text', description: 'd', category: 'data', runtime: 'static', platforms: ['pwa'], license: 'MIT' } as unknown as Repo;
    const { fixture, cmp } = setup({ initial });
    expect(cmp.form.getRawValue()).toMatchObject({ name: 'Old', platforms: ['pwa'], license: 'MIT' });
    fixture.componentRef.setInput('fieldErrors', { summary: 'Too short' });
    fixture.detectChanges();
    expect(cmp.form.controls['summary']!.getError('server')).toBe('Too short');
  });
});
