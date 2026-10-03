import type { Repo } from "@appmarket/shared";
import type { AuthVariables } from "../auth/middleware.ts";

type SessionLike = AuthVariables["session"];

/** The repo's owner or an admin. */
export function canEdit(repo: Repo, session: SessionLike): boolean {
	return !!session && (session.user.id === repo.owner.id || session.user.role === "admin");
}

/** Published repos are public; others only to the owner and admins. */
export function canView(repo: Repo, session: SessionLike): boolean {
	return repo.state === "published" || canEdit(repo, session);
}
