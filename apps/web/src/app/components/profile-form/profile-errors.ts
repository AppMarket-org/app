import { HttpErrorResponse } from '@angular/common/http';

/** API validation issues ({ issues: [{ path, message }] }) by field name. */
export function profileErrors(error: unknown): Record<string, string> {
  if (!(error instanceof HttpErrorResponse)) return {};
  const issues = (error.error as { issues?: { path: string; message: string }[] } | null)?.issues ?? [];
  return Object.fromEntries(issues.map((i) => [i.path, i.message]));
}
