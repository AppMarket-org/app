import { TestBed } from '@angular/core/testing';
import type { Repo } from '@appmarket/shared';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { Developer } from '../../../api/developer';
import { VisibilityCard } from './visibility-card';

async function render(repo: Partial<Repo>) {
  const setVisibility = vi.fn((_path: string, visibility: string) => of({ ...repo, visibility } as Repo));
  TestBed.configureTestingModule({ providers: [{ provide: Developer, useValue: { setVisibility } }] });
  const fixture = TestBed.createComponent(VisibilityCard);
  fixture.componentRef.setInput('repo', { fullName: 'cport1/counter', state: 'draft', visibility: 'private', ...repo } as Repo);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, setVisibility };
}

describe('VisibilityCard (#366)', () => {
  it('makes a private repo public with Save, enabled only after a change', async () => {
    const { el, fixture, setVisibility } = await render({});
    const save = el.querySelector('mat-card-actions button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    (el.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click();
    fixture.detectChanges();
    expect(save.disabled).toBe(false);
    save.click();
    await fixture.whenStable();
    expect(setVisibility).toHaveBeenCalledWith('cport1/counter', 'public');
  });

  it('keeps a published app public', async () => {
    const { el } = await render({ state: 'published', visibility: 'public' });
    expect((el.querySelectorAll('input[type="radio"]')[0] as HTMLInputElement).disabled).toBe(true);
    expect(el.textContent).toContain('A published app is public');
  });
});
