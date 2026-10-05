import { structuredPatch } from "diff";

/**
 * #257: the pieces of a pull request's diff that need no Git server: the merge base from two
 * commit histories, the files that differ between two trees, and per-file hunks.
 */
export interface CommitInfo {
	hash: string;
	parents: string[];
}

/**
 * The best common ancestor: the commit reachable from the head that is closest to it (breadth
 * first through parents) and also an ancestor of the base. `base` and `head` are their logs
 * (ancestors included, newest first).
 */
export function mergeBase(base: CommitInfo[], head: CommitInfo[]): string | null {
	const inBase = new Set(base.map((c) => c.hash));
	const byHash = new Map(head.map((c) => [c.hash, c]));
	const start = head[0]?.hash;
	if (!start) return null;
	const queue = [start];
	const seen = new Set(queue);
	while (queue.length) {
		const hash = queue.shift()!;
		if (inBase.has(hash)) return hash;
		for (const p of byHash.get(hash)?.parents ?? []) {
			if (!seen.has(p)) {
				seen.add(p);
				queue.push(p);
			}
		}
	}
	return null;
}

/** The pull request's own commits: reachable from the head but not from the merge base, oldest first. */
export function commitsSince(head: CommitInfo[], base: string | null, baseAncestors: Set<string>): string[] {
	const out: string[] = [];
	for (const c of head) {
		if (c.hash === base || baseAncestors.has(c.hash)) continue;
		out.push(c.hash);
	}
	return out.reverse();
}

export interface TreeEntry {
	name: string;
	type: string;
	hash: string;
	mode?: string;
}
export type TreeReader = (hash: string) => Promise<TreeEntry[] | null>;

export interface ChangedFile {
	path: string;
	status: "added" | "modified" | "deleted";
	oldHash: string | null;
	newHash: string | null;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Files that differ between two trees (unchanged subtrees are skipped by hash). */
export async function diffTrees(readOld: TreeReader, readNew: TreeReader, oldRoot: string | null, newRoot: string | null, limit = 1000): Promise<{ files: ChangedFile[]; truncated: boolean }> {
	const files: ChangedFile[] = [];
	let truncated = false;
	const walk = async (prefix: string, oldHash: string | null, newHash: string | null): Promise<void> => {
		if (truncated || oldHash === newHash) return;
		const [a, b] = await Promise.all([oldHash ? readOld(oldHash) : [], newHash ? readNew(newHash) : []]);
		const left = new Map((a ?? []).map((e) => [e.name, e]));
		const right = new Map((b ?? []).map((e) => [e.name, e]));
		for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
			const o = left.get(name);
			const n = right.get(name);
			if (o?.hash === n?.hash && o?.type === n?.type) continue;
			const path = prefix + name;
			const oTree = o?.type === "tree";
			const nTree = n?.type === "tree";
			if (oTree || nTree) {
				if (SKIP_DIRS.has(name)) continue;
				await walk(`${path}/`, oTree ? o!.hash : null, nTree ? n!.hash : null);
			}
			const oFile = o && !oTree ? o : null;
			const nFile = n && !nTree ? n : null;
			if (oFile || nFile) {
				if (files.length >= limit) {
					truncated = true;
					return;
				}
				files.push({ path, status: !oFile ? "added" : !nFile ? "deleted" : "modified", oldHash: oFile?.hash ?? null, newHash: nFile?.hash ?? null });
			}
		}
	};
	await walk("", oldRoot, newRoot);
	return { files: files.sort((x, y) => x.path.localeCompare(y.path)), truncated };
}

/** Git's rule: a NUL byte in the first 8 KB means binary. */
export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8192).includes(0);

export interface Hunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	/** Each line prefixed with ' ', '+' or '-'. */
	lines: string[];
}

export function fileHunks(oldText: string, newText: string, context = 3): { hunks: Hunk[]; additions: number; deletions: number } {
	const patch = structuredPatch("a", "b", oldText, newText, "", "", { context });
	let additions = 0;
	let deletions = 0;
	const hunks = patch.hunks.map((h) => {
		const lines = h.lines.filter((l) => !l.startsWith("\\"));
		for (const l of lines) {
			if (l.startsWith("+")) additions++;
			else if (l.startsWith("-")) deletions++;
		}
		return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines };
	});
	return { hunks, additions, deletions };
}
