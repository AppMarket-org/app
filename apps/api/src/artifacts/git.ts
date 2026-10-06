import { languageOf } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { refUpdateBody, refUpdateResult } from "../git/ref-update.ts";
import { parseBranches, parseRefs } from "../previews/refs.ts";

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

/**
 * #30 (R10): a new Artifacts repo imported from a public GitHub repository (one branch, or the
 * default). The initial write token is revoked like on create (R3 mints scoped tokens).
 */
export async function importGitRepo(name: string, url: string, branch?: string): Promise<void> {
	const created = await env.ARTIFACTS.import({ source: { url: url.replace(/\/$/, ""), ...(branch ? { branch } : {}) }, target: { name } });
	using git = await env.ARTIFACTS.get(created.name);
	await git.revokeToken(created.token);
}

/** #26: a native Artifacts fork of `source` (all refs, so the published tag comes along). */
export async function forkGitRepo(source: string, name: string): Promise<void> {
	using git = await env.ARTIFACTS.get(source);
	await git.fork(name, { defaultBranchOnly: false });
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

/**
 * #28: the repo's branches with their head commits, read from Git's ref advertisement with a
 * short-lived read token that is revoked right after.
 */
export async function listBranches(gitRepo: string): Promise<{ defaultBranch: string; branches: { name: string; sha: string }[] }> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const [info, token] = await Promise.all([git.info(), git.createToken("read", 300)]);
	try {
		const response = await fetch(`${info.remote}/info/refs?service=git-upload-pack`, { headers: { Authorization: `Bearer ${token.plaintext}` } });
		if (!response.ok) throw new Error(`info/refs: HTTP ${response.status}`);
		return { defaultBranch: info.defaultBranch, branches: parseBranches(await response.text()) };
	} finally {
		await git.revokeToken(token.id).catch(() => false);
	}
}

/** #34: all branches and tags (peeled to commits), read like listBranches. */
export async function listRefs(gitRepo: string): Promise<{ remote: string; defaultBranch: string; refs: Record<string, string> }> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const [info, token] = await Promise.all([git.info(), git.createToken("read", 300)]);
	try {
		const response = await fetch(`${info.remote}/info/refs?service=git-upload-pack`, { headers: { Authorization: `Bearer ${token.plaintext}` } });
		if (!response.ok) throw new Error(`info/refs: HTTP ${response.status}`);
		return { remote: info.remote, defaultBranch: info.defaultBranch, refs: parseRefs(await response.text()) };
	} finally {
		await git.revokeToken(token.id).catch(() => false);
	}
}

/**
 * #41: every file of a commit (except .git and node_modules) with its Git mode, or complete:false
 * when the repo is larger than the limits. Code search includes tracked dependencies explicitly.
 */
export async function sourceFiles(gitRepo: string, commit: string, limits: { maxFiles: number; maxDirs: number; includeDependencies?: boolean } = { maxFiles: 5000, maxDirs: 2000 }): Promise<{ files: { path: string; hash: string; mode: string }[]; complete: boolean }> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const meta = await git.readCommit(commit);
	if (!meta) return { files: [], complete: false };
	const files: { path: string; hash: string; mode: string }[] = [];
	const queue = [{ prefix: "", hash: meta.treeHash }];
	let dirs = 0;
	while (queue.length > 0) {
		if (++dirs > limits.maxDirs) return { files, complete: false };
		const { prefix, hash } = queue.shift()!;
		for (const e of (await git.readTree(hash)) ?? []) {
			// Names Git itself refuses never reach an archive (#41).
			if (!e.name || e.name === "." || e.name === ".." || /[/\\\x00-\x1f]/.test(e.name)) continue;
			if (e.type === "tree") {
				if (e.name !== ".git" && (e.name !== "node_modules" || limits.includeDependencies)) queue.push({ prefix: `${prefix}${e.name}/`, hash: e.hash });
			} else if (e.type === "blob" || e.type === "exec" || e.type === "symlink") {
				files.push({ path: prefix + e.name, hash: e.hash, mode: e.mode });
				if (files.length > limits.maxFiles) return { files, complete: false };
			}
		}
	}
	return { files: files.sort((a, b) => a.path.localeCompare(b.path)), complete: true };
}

/** #41: one blob's bytes. */
export async function readBlobBytes(gitRepo: string, hash: string): Promise<Uint8Array | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const blob = await git.readBlob(hash);
	return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
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

/**
 * Moves a branch to a commit the repo already has, only if it still points at `oldSha` (a
 * compare-and-swap; no container needed). "stale" means the branch moved; "error" means the
 * result is unknown (the caller re-reads the branch).
 */
export async function updateRef(gitRepo: string, branch: string, oldSha: string, newSha: string): Promise<"ok" | "stale" | "error"> {
	const ref = `refs/heads/${branch}`;
	const token = await mintGitToken(gitRepo, "write", 120);
	try {
		const response = await fetch(`${token.remote}/git-receive-pack`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/x-git-receive-pack-request", Accept: "application/x-git-receive-pack-result" },
			body: refUpdateBody(ref, oldSha, newSha),
		});
		if (!response.ok) return "error";
		return refUpdateResult(await response.text(), ref);
	} catch {
		return "error";
	} finally {
		await revokeGitToken(gitRepo, token.id).catch(() => false);
	}
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
export async function listTree(gitRepo: string, commit: string, limits = { maxEntries: 2000, maxDirs: 300 }): Promise<{ path: string; type: string; hash: string }[]> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const meta = await git.readCommit(commit);
	if (!meta) return [];
	const entries: { path: string; type: string; hash: string }[] = [];
	const queue: { prefix: string; hash: string }[] = [{ prefix: "", hash: meta.treeHash }];
	let dirs = 0;
	while (queue.length > 0 && dirs < limits.maxDirs && entries.length < limits.maxEntries) {
		const { prefix, hash } = queue.shift()!;
		dirs++;
		for (const e of (await git.readTree(hash)) ?? []) {
			const path = prefix + e.name;
			entries.push({ path, type: e.type, hash: e.hash });
			if (e.type === "tree" && !SKIP_DIRS.has(e.name)) queue.push({ prefix: `${path}/`, hash: e.hash });
			if (entries.length >= limits.maxEntries) break;
		}
	}
	return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * #170: bytes per language in a commit. The tree API has no sizes, so each counted file's blob
 * is read for its size (16 at a time, at most 1,500 files).
 */
export async function languageBytes(gitRepo: string, commit: string): Promise<Record<string, number>> {
	const files = (await listTree(gitRepo, commit, { maxEntries: 5000, maxDirs: 600 }))
		.filter((e) => e.type === "blob")
		.flatMap((e) => {
			const language = languageOf(e.path);
			return language ? [{ ...e, language }] : [];
		})
		.slice(0, 1500);
	using git = await env.ARTIFACTS.get(gitRepo);
	const bytes: Record<string, number> = {};
	for (let i = 0; i < files.length; i += 16) {
		const sizes = await Promise.all(files.slice(i, i + 16).map((f) => git.readBlob(f.hash).then((b) => b?.size ?? 0).catch(() => 0)));
		files.slice(i, i + 16).forEach((f, k) => (bytes[f.language] = (bytes[f.language] ?? 0) + sizes[k]!));
	}
	return bytes;
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
/**
 * The default branch's recent commits, newest first. Callers detect pushes by comparing the head
 * with the last one they processed: Artifacts does not report push times (lastPushAt and updatedAt
 * stay at the repo's creation).
 */
export async function pushedCommits(gitRepo: string, limit = 200): Promise<{ commits: ArtifactsCommitMetadata[]; defaultBranch: string }> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const info = await git.info();
	return { commits: await git.log({ ref: info.defaultBranch, limit }).catch(() => []), defaultBranch: info.defaultBranch };
}

/** Code browser: a ref (branch, tag or commit) resolved to its commit, or null. */
export async function resolveRef(gitRepo: string, ref: string): Promise<string | null> {
	// Artifacts log() accepts short names only. Resolve qualified refs from Git's advertisement
	// so a tag can be selected even when a branch has the same name.
	if (ref.startsWith("refs/heads/") || ref.startsWith("refs/tags/")) {
		const result = await listRefs(gitRepo).catch(() => null);
		return result?.refs[ref] ?? null;
	}
	using git = await env.ARTIFACTS.get(gitRepo);
	const [commit] = await git.log({ ref, limit: 1 }).catch(() => []);
	return commit?.hash ?? null;
}

/** Code browser: the entries of one directory at a commit ("" is the root), or null if there is no such directory. */
export async function readDirectory(gitRepo: string, commit: string, path: string): Promise<{ name: string; type: "tree" | "blob" | "link"; hash: string }[] | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	const meta = await git.readCommit(commit);
	if (!meta) return null;
	let tree = meta.treeHash;
	for (const segment of path.split("/").filter(Boolean)) {
		const entry = ((await git.readTree(tree)) ?? []).find((e) => e.name === segment && e.type === "tree");
		if (!entry) return null;
		tree = entry.hash;
	}
	const entries = (await git.readTree(tree)) ?? [];
	return entries
		.map((e) => ({ name: e.name, type: (e.mode === "120000" ? "link" : e.type === "tree" ? "tree" : "blob") as "tree" | "blob" | "link", hash: e.hash }))
		.sort((a, b) => (a.type === "tree") === (b.type === "tree") ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1);
}

/** Code browser: one file's bytes at a commit (null if missing). */
export async function readPath(gitRepo: string, commit: string, path: string): Promise<Blob | null> {
	using git = await env.ARTIFACTS.get(gitRepo);
	return git.readFile({ ref: commit, path });
}
