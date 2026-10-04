import { env } from "cloudflare:workers";

/** Repo name for a repo: readable slug plus a short id, within Artifacts' 63-character limit. */
export function gitRepoNameFor(slug: string, repoId: string): string {
	return `${slug.slice(0, 54).replace(/-+$/, "")}-${repoId.replace(/-/g, "").slice(0, 8)}`;
}

/**
 * PRD R2: one Artifacts Git repository per repo. create() also returns a write token; nothing uses it
 * (R3 mints scoped tokens), so it is revoked at once instead of staying valid until it expires.
 */
export async function createGitRepo(name: string): Promise<{ name: string; remote: string }> {
	const created = await env.ARTIFACTS.create(name);
	using git = await env.ARTIFACTS.get(created.name);
	await git.revokeToken(created.token);
	return { name: created.name, remote: created.remote };
}

export async function deleteGitRepo(name: string): Promise<void> {
	await env.ARTIFACTS.delete(name);
}

/**
 * Commit hash a tag points to, or null if it does not resolve. The binding's log() accepts short
 * ref names only (`v1.0.0`, not `refs/tags/v1.0.0`), so a branch with the same name would also match.
 */
export async function resolveTag(gitRepo: string, tag: string): Promise<string | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const [commit] = await git.log({ ref: tag, limit: 1 });
	return commit?.hash ?? null;
}

/** PRD R3: mint a repo-scoped token. The plaintext is returned to the caller once and never stored. */
export async function mintGitToken(gitRepo: string, scope: "read" | "write", ttl: number) {
	using git = await env.ARTIFACTS.get(gitRepo);
	const [token, info] = await Promise.all([git.createToken(scope, ttl), git.info()]);
	return { id: token.id, token: token.plaintext, expiresAt: token.expiresAt, remote: info.remote };
}

/** PRD R19: live token metadata for a repo (no plaintext). */
export async function listGitTokens(gitRepo: string) {
	using git = await env.ARTIFACTS.get(gitRepo);
	return (await git.listTokens()).tokens;
}

export async function revokeGitToken(gitRepo: string, tokenId: string): Promise<boolean> {
	using git = await env.ARTIFACTS.get(gitRepo);
	return git.revokeToken(tokenId);
}

/** Revokes every active token on the repo; returns the revoked ids. */
export async function revokeAllGitTokens(gitRepo: string): Promise<string[]> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const active = (await git.listTokens()).tokens.filter((t) => t.state === "active");
	await Promise.all(active.map((t) => git.revokeToken(t.id)));
	return active.map((t) => t.id);
}

/** PRD R26: top-level entries of a commit's tree (for the runtime check). */
export async function readRootEntries(gitRepo: string, commit: string): Promise<{ name: string; type: string }[]> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const meta = await git.readCommit(commit);
	if (!meta) return [];
	return ((await git.readTree(meta.treeHash)) ?? []).map((e) => ({ name: e.name, type: e.type }));
}

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.markdown", "README"];
const README_MAX_BYTES = 512 * 1024;

/** PRD R24: README at a commit, as Markdown text, or null if the repo has none (or it is too large). */
export async function readReadme(gitRepo: string, commit: string): Promise<string | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	for (const path of README_NAMES) {
		const file = await git.readFile({ ref: commit, path });
		if (file) return file.size > README_MAX_BYTES ? null : file.text();
	}
	return null;
}

/** PRD R16: the repo's Git remote (no credentials) for the owner's dashboard. */
export async function gitRemote(gitRepo: string): Promise<string> {
	using git = await env.ARTIFACTS.get(gitRepo);
	return (await git.info()).remote;
}

/** PRD D2/G4: the files the template contract reads, at one commit (missing files are skipped). */
export async function readFiles(gitRepo: string, commit: string, paths: readonly string[]): Promise<Map<string, string>> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const files = new Map<string, string>();
	await Promise.all(
		paths.map(async (path) => {
			const blob = await git.readFile({ ref: commit, path });
			if (blob && blob.size <= 256 * 1024) files.set(path, await blob.text());
		}),
	);
	return files;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".wrangler", ".cloudflare", ".angular", ".next", "coverage", "vendor"]);

/**
 * G4: the file tree of a commit, breadth first, skipping build output and dependencies, bounded so
 * a huge repo cannot make publish slow.
 */
export async function listTree(gitRepo: string, commit: string, limits = { maxEntries: 2000, maxDirs: 300 }): Promise<{ path: string; type: string }[]> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const meta = await git.readCommit(commit);
	if (!meta) return [];
	const entries: { path: string; type: string }[] = [];
	const queue: { prefix: string; hash: string }[] = [{ prefix: "", hash: meta.treeHash }];
	let dirs = 0;
	while (queue.length > 0 && dirs < limits.maxDirs && entries.length < limits.maxEntries) {
		const { prefix, hash } = queue.shift()!;
		dirs++;
		for (const e of (await git.readTree(hash)) ?? []) {
			const path = prefix + e.name;
			entries.push({ path, type: e.type });
			if (e.type === "tree" && !SKIP_DIRS.has(e.name)) queue.push({ prefix: `${path}/`, hash: e.hash });
			if (entries.length >= limits.maxEntries) break;
		}
	}
	return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** Checkpoints: whether a commit has reached appmarket.org yet (pending vs attached). */
export async function commitExists(gitRepo: string, sha: string): Promise<boolean> {
	using git = await env.ARTIFACTS.get(gitRepo);
	return !!(await git.readCommit(sha).catch(() => null));
}

/**
 * #124: when the repo last changed (its last push; for repos filled another way, e.g. an import,
 * its last update) and the newest commits on its default branch.
 */
export async function pushedCommits(gitRepo: string, limit = 200): Promise<{ lastPushAt: string | null; commits: ArtifactsCommitMetadata[] }> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const info = await git.info();
	const changedAt = info.lastPushAt ?? info.updatedAt;
	return { lastPushAt: changedAt, commits: await git.log({ ref: info.defaultBranch, limit }).catch(() => []) };
}
