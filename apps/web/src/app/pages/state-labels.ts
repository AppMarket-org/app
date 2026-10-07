import type { RepoState, RepoVisibility } from '@appmarket/shared';

/** Owner-facing wording for a repo's marketplace state. */
export const STATE_LABELS: Record<RepoState, { label: string; help: string }> = {
  draft: { label: 'Draft', help: 'Not on the marketplace: submit a tagged version for review to list it.' },
  submitted: { label: 'In review', help: 'An admin is reviewing the submitted version.' },
  published: { label: 'Published', help: 'On the marketplace: anyone can find, deploy and fork it.' },
  unpublished: { label: 'Unpublished', help: 'Off the marketplace. Submit a version to list it again.' },
  removed: { label: 'Deleted', help: 'Deleted for good. Its tokens are revoked.' },
};

/** #366: who can read a repo. */
export const VISIBILITY_LABELS: Record<RepoVisibility, { label: string; icon: string; help: string }> = {
  private: { label: 'Private', icon: 'lock', help: 'Only you and your organization can see it.' },
  public: { label: 'Public', icon: 'public', help: 'Anyone can read its code.' },
};
