import { TestBed } from '@angular/core/testing';
import type { OwnerProfileUpdate } from '@appmarket/shared';
import { ProfileForm } from './profile-form';

function setup(kind: 'user' | 'org') {
  const fixture = TestBed.createComponent(ProfileForm);
  fixture.componentRef.setInput('kind', kind);
  fixture.componentRef.setInput('name', 'Jane');
  fixture.componentRef.setInput('profile', { bio: 'Hi', memberSince: '2026-01-01T00:00:00Z' });
  fixture.detectChanges();
  const saved: OwnerProfileUpdate[] = [];
  fixture.componentInstance.save.subscribe((u) => saved.push(u));
  const cmp = fixture.componentInstance as unknown as { form: { patchValue(v: object): void }; submit(): void };
  return { cmp, saved };
}

describe('ProfileForm', () => {
  it('emits trimmed values, with empty fields as null', () => {
    const { cmp, saved } = setup('user');
    cmp.form.patchValue({ name: '  ', bio: ' Builds things ', website: 'https://jane.example.test' });
    cmp.submit();
    expect(saved).toEqual([{ name: null, bio: 'Builds things', location: null, website: 'https://jane.example.test' }]);
  });

  it('refuses a non-https website, and an empty organization name', () => {
    const user = setup('user');
    user.cmp.form.patchValue({ website: 'http://jane.example.test' });
    user.cmp.submit();
    expect(user.saved).toEqual([]);
    const org = setup('org');
    org.cmp.form.patchValue({ name: '' });
    org.cmp.submit();
    expect(org.saved).toEqual([]);
  });
});
