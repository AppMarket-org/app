import type { Listing } from "@appmarket/shared";
import type { AuthVariables } from "../auth/middleware.ts";

type SessionLike = AuthVariables["session"];

/** The listing's owner or an admin. */
export function canEdit(listing: Listing, session: SessionLike): boolean {
	return !!session && (session.user.id === listing.owner.id || session.user.role === "admin");
}

/** Published listings are public; others only to the owner and admins. */
export function canView(listing: Listing, session: SessionLike): boolean {
	return listing.state === "published" || canEdit(listing, session);
}
