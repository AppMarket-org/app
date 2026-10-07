import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { A2aKeysCard } from './a2a-keys-card';

describe('A2aKeysCard', () => {
  it('creates a key, shows it once with an example, and lists the keys', async () => {
    const key = { id: 'k1', name: 'Release orchestrator', prefix: 'ama2a_abc123', createdBy: 'Chris', createdAt: '2026-10-07T10:00:00Z', expiresAt: '2027-01-05T10:00:00Z', lastUsedAt: null };
    let items: unknown[] = [];
    const post = vi.fn(() => {
      items = [key];
      return of({ key: 'ama2a_secret', record: key });
    });
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get: vi.fn(() => of({ items })), post, delete: vi.fn() } }] });
    const fixture = TestBed.createComponent(A2aKeysCard);
    fixture.componentRef.setInput('path', 'cport1/counter');
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input[name="name"]') as HTMLInputElement;
    input.value = 'Release orchestrator';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('mat-card-actions button') as HTMLButtonElement).click();
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    expect(post).toHaveBeenCalledWith('/api/repos/cport1/counter/a2a-keys', { name: 'Release orchestrator', days: 90 });
    expect(el.querySelector('.created')?.textContent).toContain('ama2a_secret');
    expect(el.querySelector('.created')?.textContent).toContain('https://appmarket.org/api/repos/cport1/counter/a2a');
    expect(el.querySelector('mat-list')?.textContent).toContain('Release orchestrator');
    expect(el.querySelector('mat-list')?.textContent).toContain('Never used');
  });
});
