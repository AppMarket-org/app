import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { Repo } from '@appmarket/shared';
import { PinsDialog } from './pins-dialog';

const repo = (n: number) => ({ id: `r${n}`, name: `App ${n}`, fullName: `dev/app-${n}` }) as Repo;

describe('PinsDialog', () => {
  it('pins at most six, reorders by identity and saves paths in order', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: MAT_DIALOG_DATA, useValue: {} }, { provide: MatDialogRef, useValue: { close } }] });
    const fixture = TestBed.createComponent(PinsDialog);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/me/pins').flush({ pinned: [repo(1)], candidates: [1, 2, 3, 4, 5, 6, 7].map(repo) });
    await fixture.whenStable();
    const cmp = fixture.componentInstance as unknown as { toggle(r: Repo, on: boolean): void; move(r: Repo, by: -1 | 1): void; selected(): Repo[]; save(): Promise<void> };
    for (const n of [2, 3, 4, 5, 6, 7]) cmp.toggle(repo(n), true);
    expect(cmp.selected().map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    cmp.move(repo(6), -1);
    cmp.move(repo(1), -1); // already first: no change
    expect(cmp.selected().map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r6', 'r5']);
    const saving = cmp.save();
    const req = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/me/pins');
    expect(req.request.body).toEqual({ repos: ['dev/app-1', 'dev/app-2', 'dev/app-3', 'dev/app-4', 'dev/app-6', 'dev/app-5'] });
    req.flush({ pinned: [] });
    await saving;
    expect(close).toHaveBeenCalledWith([]);
  });
});
