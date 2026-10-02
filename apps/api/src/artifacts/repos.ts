import { env } from "cloudflare:workers";

/** Repo name for a listing: readable slug plus a short id, within Artifacts' 63-character limit. */
export function repoNameFor(slug: string, listingId: string): string {
	return `${slug.slice(0, 54).replace(/-+$/, "")}-${listingId.replace(/-/g, "").slice(0, 8)}`;
}

/** PRD R2: one Artifacts repo per listing. The initial write token is discarded; R3 mints scoped tokens. */
export async function createListingRepo(name: string): Promise<{ name: string; remote: string }> {
	const created = await env.ARTIFACTS.create(name);
	return { name: created.name, remote: created.remote };
}

export async function deleteListingRepo(name: string): Promise<void> {
	await env.ARTIFACTS.delete(name);
}

/**
 * Commit hash a tag points to, or null if it does not resolve. The binding's log() accepts short
 * ref names only (`v1.0.0`, not `refs/tags/v1.0.0`), so a branch with the same name would also match.
 */
export async function resolveTag(repoName: string, tag: string): Promise<string | null> {
	using repo = await env.ARTIFACTS.get(repoName);
	const [commit] = await repo.log({ ref: tag, limit: 1 });
	return commit?.hash ?? null;
}

/** PRD R3: mint a repo-scoped token. The plaintext is returned to the caller once and never stored. */
export async function mintRepoToken(repoName: string, scope: "read" | "write", ttl: number) {
	using repo = await env.ARTIFACTS.get(repoName);
	const [token, info] = await Promise.all([repo.createToken(scope, ttl), repo.info()]);
	return { id: token.id, token: token.plaintext, expiresAt: token.expiresAt, remote: info.remote };
}
