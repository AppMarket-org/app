// Listing lifecycle (PRD R12). A published version pins to a Git tag in the app's Artifacts repo.
export const LISTING_STATES = ["draft", "submitted", "published", "unpublished", "removed"] as const;
export type ListingState = (typeof LISTING_STATES)[number];

const TRANSITIONS: Record<ListingState, readonly ListingState[]> = {
  draft: ["submitted", "removed"],
  submitted: ["draft", "published", "removed"],
  published: ["unpublished", "removed"],
  unpublished: ["submitted", "removed"],
  removed: [],
};

export function canTransition(from: ListingState, to: ListingState): boolean {
  return TRANSITIONS[from].includes(to);
}

// Target platforms (PRD R24, D4, M1-M4).
export type TargetPlatform = "workers" | "pwa" | "android" | "ios" | "download";
