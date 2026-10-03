import { TestBed } from '@angular/core/testing';
import type { Repo, RepoInput } from '@appmarket/shared';
import { RepoForm } from './repo-form';

interface Internals {
  form: { patchValue(v: object): void; getRawValue(): Record<string, unknown>; controls: Record<string, { getError(k: string): unknown }> };
  submit(): void;
}

function setup(inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(RepoForm);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const emitted: RepoInput[] = [];
  fixture.componentInstance.saved.subscribe((v) => emitted.push(v));
  return { fixture, cmp: fixture.componentInstance as unknown as Internals, emitted };
}

describe('RepoForm', () => {
  it('emits a clean value and normalises an empty license to null', () => {
    const { cmp, emitted } = setup();
    cmp.form.patchValue({ name: 'My App', summary: 'Does useful things', category: 'ai', license: '  ' });
    cmp.submit();
    expect(emitted).toEqual([{ name: 'My App', summary: 'Does useful things', description: '', category: 'ai', runtime: 'workers-js', platforms: ['workers'], license: null }]);
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

  it('prefills from an existing repo and shows server field errors', () => {
    const initial = { name: 'Old', summary: 'Old summary text', description: 'd', category: 'data', runtime: 'static', platforms: ['pwa'], license: 'MIT' } as unknown as Repo;
    const { fixture, cmp } = setup({ initial });
    expect(cmp.form.getRawValue()).toMatchObject({ name: 'Old', runtime: 'static', platforms: ['pwa'], license: 'MIT' });
    fixture.componentRef.setInput('fieldErrors', { summary: 'Too short' });
    fixture.detectChanges();
    expect(cmp.form.controls['summary']!.getError('server')).toBe('Too short');
  });
});
