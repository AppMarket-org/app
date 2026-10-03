import { HttpErrorResponse } from '@angular/common/http';
import { describeRepoError } from './repo-errors';

const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('describeRepoError', () => {
  it('maps validation issues onto fields', () => {
    expect(describeRepoError(http(400, { error: 'invalid', issues: [{ path: 'name', message: 'Too short' }] }))).toEqual({
      message: 'Please fix the highlighted fields.',
      fieldErrors: { name: 'Too short' },
    });
  });

  it('explains quota, removed, rate limit and session errors', () => {
    expect(describeRepoError(http(409, { error: 'quota_exceeded', limit: 25 })).message).toContain('limit of 25');
    expect(describeRepoError(http(409, { error: 'removed' })).message).toContain('removed');
    expect(describeRepoError(http(429, {})).message).toContain('Wait a minute');
    expect(describeRepoError(http(401, {})).message).toContain('Sign in again');
    expect(describeRepoError(new Error('x')).message).toContain('Something went wrong');
  });
});
