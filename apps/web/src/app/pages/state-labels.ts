import type { ListingState } from '@appmarket/shared';

/** Owner-facing wording for listing states. */
export const STATE_LABELS: Record<ListingState, { label: string; help: string }> = {
  draft: { label: 'Draft', help: 'Only you can see it. Push code and submit a tagged version for review.' },
  submitted: { label: 'In review', help: 'An admin is reviewing the submitted version.' },
  published: { label: 'Published', help: 'Public in the catalog.' },
  unpublished: { label: 'Unpublished', help: 'Hidden from the catalog. Submit a version to publish again.' },
  removed: { label: 'Removed', help: 'Removed for good. Its tokens are revoked.' },
};
