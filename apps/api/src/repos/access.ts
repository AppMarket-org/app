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

/** #366: anyone may read a public repo (published ones always are); others only the owner and admins. */
export function isPublic(repo: Pick<Repo, "state" | "visibility">): boolean {
	return repo.state === "published" || (repo.visibility === "public" && repo.state !== "removed");
}

export function canView(repo: Repo, session: SessionLike): boolean {
	return isPublic(repo) || canEdit(repo, session);
}

/**
 * #366: may read any branch, tag or commit in the code browser: owners and admins, and everyone
 * for a public repo, except a paid app, whose visitors see only its published version.
 */
export function canBrowse(repo: Repo, session: SessionLike): boolean {
	if (canEdit(repo, session)) return true;
	return repo.visibility === "public" && repo.state !== "removed" && !(repo.state === "published" && repo.priceCents > 0);
}
