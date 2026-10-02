import { HttpErrorResponse } from '@angular/common/http';
import { describeListingError } from './listing-errors';

const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('describeListingError', () => {
  it('maps validation issues onto fields', () => {
    expect(describeListingError(http(400, { error: 'invalid', issues: [{ path: 'name', message: 'Too short' }] }))).toEqual({
      message: 'Please fix the highlighted fields.',
      fieldErrors: { name: 'Too short' },
    });
  });

  it('explains quota, removed, rate limit and session errors', () => {
    expect(describeListingError(http(409, { error: 'quota_exceeded', limit: 25 })).message).toContain('limit of 25');
    expect(describeListingError(http(409, { error: 'removed' })).message).toContain('removed');
    expect(describeListingError(http(429, {})).message).toContain('Wait a minute');
    expect(describeListingError(http(401, {})).message).toContain('Sign in again');
    expect(describeListingError(new Error('x')).message).toContain('Something went wrong');
  });
});
