import type { Repo } from "@appmarket/shared";
import type { AuthVariables } from "../auth/middleware.ts";

type SessionLike = AuthVariables["session"];

/** The repo's owner: the user it lives under, or a member of its organization (#102). Not admins. */
export function isOwner(repo: Repo, who: { id: string; orgIds: readonly string[] }): boolean {
	return who.id === repo.owner.id || who.orgIds.includes(repo.owner.id);
}

/** The repo's owner or an admin. */
export function canEdit(repo: Repo, session: SessionLike): boolean {
	if (!session) return false;
	return isOwner(repo, { id: session.user.id, orgIds: session.orgIds }) || session.user.role === "admin";
}

/** Published repos are public; others only to the owner and admins. */
export function canView(repo: Repo, session: SessionLike): boolean {
	return repo.state === "published" || canEdit(repo, session);
}
