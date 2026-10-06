import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { EmailCard } from './email-card';

it('shows a failed load and recovers through Try again without changing preferences', async () => {
  const get = vi.fn()
    .mockReturnValueOnce(throwError(() => new Error('Unavailable')))
    .mockReturnValueOnce(of({ impacts: true, pulls: false, issues: true, sending: true }));
  const put = vi.fn();
  TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get, put } }] });
  const fixture = TestBed.createComponent(EmailCard);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not load');
  fixture.nativeElement.querySelector('button').click();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  expect(fixture.nativeElement.querySelectorAll('mat-slide-toggle').length).toBe(3);
  expect(get).toHaveBeenCalledTimes(2);
  expect(put).not.toHaveBeenCalled();
});
