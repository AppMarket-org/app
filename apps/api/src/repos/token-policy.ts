import type { Repo, Role } from "@appmarket/shared";
import { isOwner as ownsRepo } from "./access.ts";

export type TokenDecision = { allowed: true } | { allowed: false; status: 403 | 404 | 409; error: string };

/**
 * PRD R3: who may mint which token. Write: the repo owner (or a member of its organization) only. Read: owner or admin for any
 * repo; any signed-in user once published (clone, fork, eject). Hidden repos stay 404.
 */
export function tokenPolicy(repo: Repo, user: { id: string; role: Role; orgIds: readonly string[] }, scope: "read" | "write"): TokenDecision {
	const isOwner = ownsRepo(repo, user);
	const isAdmin = user.role === "admin";
	if (repo.state !== "published" && !isOwner && !isAdmin) return { allowed: false, status: 404, error: "not_found" };
	if (repo.state === "removed") return { allowed: false, status: 409, error: "removed" };
	if (!repo.gitRepo) return { allowed: false, status: 409, error: "no_repo" };
	if (scope === "write" && !isOwner) return { allowed: false, status: 403, error: "forbidden" };
	return { allowed: true };
}
