import { HttpErrorResponse } from '@angular/common/http';

export interface ListingSaveError {
  message: string;
  /** API validation messages by field name. */
  fieldErrors: Record<string, string>;
}

/** Turns an API error from creating or editing a listing into a message and per-field errors. */
export function describeListingError(error: unknown): ListingSaveError {
  if (!(error instanceof HttpErrorResponse)) return { message: 'Something went wrong. Please try again.', fieldErrors: {} };
  const body = error.error as { error?: string; issues?: { path: string; message: string }[]; limit?: number } | null;
  if (error.status === 400 && body?.issues) {
    return { message: 'Please fix the highlighted fields.', fieldErrors: Object.fromEntries(body.issues.map((i) => [i.path, i.message])) };
  }
  if (error.status === 409 && body?.error === 'quota_exceeded') return { message: `You have reached the limit of ${body.limit} listings. Remove one first.`, fieldErrors: {} };
  if (error.status === 409 && body?.error === 'removed') return { message: 'This listing was removed and can no longer be edited.', fieldErrors: {} };
  if (error.status === 429) return { message: 'Too many requests in a short time. Wait a minute and try again.', fieldErrors: {} };
  if (error.status === 401) return { message: 'Your session expired. Sign in again.', fieldErrors: {} };
  return { message: 'Could not save the listing. Please try again.', fieldErrors: {} };
}
