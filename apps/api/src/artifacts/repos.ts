import { env } from "cloudflare:workers";

/** Repo name for a listing: readable slug plus a short id, within Artifacts' 63-character limit. */
export function repoNameFor(slug: string, listingId: string): string {
	return `${slug.slice(0, 54).replace(/-+$/, "")}-${listingId.replace(/-/g, "").slice(0, 8)}`;
}

/**
 * PRD R2: one Artifacts repo per listing. create() also returns a write token; nothing uses it
 * (R3 mints scoped tokens), so it is revoked at once instead of staying valid until it expires.
 */
export async function createListingRepo(name: string): Promise<{ name: string; remote: string }> {
	const created = await env.ARTIFACTS.create(name);
	using repo = await env.ARTIFACTS.get(created.name);
	await repo.revokeToken(created.token);
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

/** PRD R19: live token metadata for a repo (no plaintext). */
export async function listRepoTokens(repoName: string) {
	using repo = await env.ARTIFACTS.get(repoName);
	return (await repo.listTokens()).tokens;
}

export async function revokeRepoToken(repoName: string, tokenId: string): Promise<boolean> {
	using repo = await env.ARTIFACTS.get(repoName);
	return repo.revokeToken(tokenId);
}

/** Revokes every active token on the repo; returns the revoked ids. */
export async function revokeAllRepoTokens(repoName: string): Promise<string[]> {
	using repo = await env.ARTIFACTS.get(repoName);
	const active = (await repo.listTokens()).tokens.filter((t) => t.state === "active");
	await Promise.all(active.map((t) => repo.revokeToken(t.id)));
	return active.map((t) => t.id);
}

/** PRD R26: top-level entries of a commit's tree (for the runtime check). */
export async function readRootEntries(repoName: string, commit: string): Promise<{ name: string; type: string }[]> {
	using repo = await env.ARTIFACTS.get(repoName);
	const meta = await repo.readCommit(commit);
	if (!meta) return [];
	return ((await repo.readTree(meta.treeHash)) ?? []).map((e) => ({ name: e.name, type: e.type }));
}

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.markdown", "README"];
const README_MAX_BYTES = 512 * 1024;

/** PRD R24: README at a commit, as Markdown text, or null if the repo has none (or it is too large). */
export async function readReadme(repoName: string, commit: string): Promise<string | null> {
	using repo = await env.ARTIFACTS.get(repoName);
	for (const path of README_NAMES) {
		const file = await repo.readFile({ ref: commit, path });
		if (file) return file.size > README_MAX_BYTES ? null : file.text();
	}
	return null;
}
