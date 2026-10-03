import type { ListingState } from '@appmarket/shared';

/** Owner-facing wording for repo (listing) states. */
export const STATE_LABELS: Record<ListingState, { label: string; help: string }> = {
  draft: { label: 'Private', help: 'Only you can see it. Push code and submit a tagged version for review to make it public.' },
  submitted: { label: 'In review', help: 'An admin is reviewing the submitted version.' },
  published: { label: 'Public', help: 'On the marketplace; anyone can view and deploy it.' },
  unpublished: { label: 'Hidden', help: 'Hidden from the marketplace. Submit a version to make it public again.' },
  removed: { label: 'Deleted', help: 'Deleted for good. Its tokens are revoked.' },
};
