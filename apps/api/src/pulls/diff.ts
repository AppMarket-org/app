import { env } from "cloudflare:workers";
import { listBranches, readPath } from "../artifacts/git.ts";
import { type ChangedFile, commitsSince, diffTrees, fileHunks, type Hunk, isBinary, mergeBase } from "./diff-core.ts";

const LOG_LIMIT = 500;
const MAX_TEXT = 512 * 1024;
const MAX_STAT_FILES = 300;

export interface DiffRange {
	/** Where the old side is read (the target repo). */
	oldRepo: string;
	/** Where the new side is read (the source repo; the target once merged). */
	newRepo: string;
	base: string;
	head: string;
	commits: { sha: string; message: string; author: string; date: string }[];
}

interface PullForDiff {
	id: string;
	state: string;
	target_branch: string;
	source_branch: string;
	head_sha: string | null;
	target_git: string;
	source_git: string | null;
}

/** The commits and endpoints a pull request's diff compares, or null when they are gone. */
export async function diffRange(pull: PullForDiff): Promise<DiffRange | null> {
	if (pull.state === "merged") {
		// What landed: the merge Workflow's checked base and the commit the target fast-forwarded to.
		const m = await env.DB.prepare("SELECT base_sha, head_sha FROM merges WHERE pull_id = ? AND status = 'merged' ORDER BY created_at DESC LIMIT 1")
			.bind(pull.id)
			.first<{ base_sha: string | null; head_sha: string | null }>();
		if (!m?.base_sha || !m.head_sha) return null;
		using git = await env.ARTIFACTS.get(pull.target_git);
		const log = await git.log({ ref: m.head_sha, limit: LOG_LIMIT }).catch(() => []);
		const until = log.findIndex((c) => c.hash === m.base_sha);
		const own = (until === -1 ? log : log.slice(0, until)).reverse();
		return { oldRepo: pull.target_git, newRepo: pull.target_git, base: m.base_sha, head: m.head_sha, commits: own.map(commitInfo) };
	}
	if (!pull.source_git || !pull.head_sha) return null;
	const targetHead = (await listBranches(pull.target_git)).branches.find((b) => b.name === pull.target_branch)?.sha;
	if (!targetHead) return null;
	using target = await env.ARTIFACTS.get(pull.target_git);
	using source = await env.ARTIFACTS.get(pull.source_git);
	const [baseLog, headLog] = await Promise.all([target.log({ ref: targetHead, limit: LOG_LIMIT }).catch(() => []), source.log({ ref: pull.head_sha, limit: LOG_LIMIT }).catch(() => [])]);
	const base = mergeBase(baseLog, headLog);
	if (!base) return null;
	const own = new Set(commitsSince(headLog, base, new Set(baseLog.map((c) => c.hash))));
	const byHash = new Map(headLog.map((c) => [c.hash, c]));
	return { oldRepo: pull.target_git, newRepo: pull.source_git, base, head: pull.head_sha, commits: [...own].map((h) => commitInfo(byHash.get(h)!)) };
}

const commitInfo = (c: ArtifactsCommitMetadata) => ({ sha: c.hash, message: c.message.split("\n")[0]!.slice(0, 200), author: c.author.name, date: new Date(c.authoredAt * (c.authoredAt < 1e12 ? 1000 : 1)).toISOString() });

export interface FileStat extends ChangedFile {
	additions: number | null;
	deletions: number | null;
	binary: boolean;
	tooLarge: boolean;
}

async function text(repo: ArtifactsRepo, hash: string | null): Promise<{ text: string; binary: boolean; tooLarge: boolean }> {
	if (!hash) return { text: "", binary: false, tooLarge: false };
	const blob = await repo.readBlob(hash);
	if (!blob) return { text: "", binary: false, tooLarge: false };
	if (blob.size > MAX_TEXT) return { text: "", binary: false, tooLarge: true };
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return isBinary(bytes) ? { text: "", binary: true, tooLarge: false } : { text: new TextDecoder().decode(bytes), binary: false, tooLarge: false };
}

/** Files changed between the merge base and the head, with line counts (for the first 300). */
export async function changedFiles(range: DiffRange): Promise<{ files: FileStat[]; truncated: boolean }> {
	using older = await env.ARTIFACTS.get(range.oldRepo);
	using newer = await env.ARTIFACTS.get(range.newRepo);
	const [a, b] = await Promise.all([older.readCommit(range.base), newer.readCommit(range.head)]);
	const { files, truncated } = await diffTrees(
		(h) => older.readTree(h),
		(h) => newer.readTree(h),
		a?.treeHash ?? null,
		b?.treeHash ?? null,
	);
	const stats: FileStat[] = [];
	for (let i = 0; i < files.length; i += 12) {
		stats.push(
			...(await Promise.all(
				files.slice(i, i + 12).map(async (f, j): Promise<FileStat> => {
					if (i + j >= MAX_STAT_FILES) return { ...f, additions: null, deletions: null, binary: false, tooLarge: false };
					const [o, n] = await Promise.all([text(older, f.oldHash), text(newer, f.newHash)]);
					if (o.binary || n.binary || o.tooLarge || n.tooLarge) return { ...f, additions: null, deletions: null, binary: o.binary || n.binary, tooLarge: o.tooLarge || n.tooLarge };
					const { additions, deletions } = fileHunks(o.text, n.text, 0);
					return { ...f, additions, deletions, binary: false, tooLarge: false };
				}),
			)),
		);
	}
	return { files: stats, truncated };
}

/** One file's hunks (with 3 lines of context). */
export async function fileDiff(range: DiffRange, path: string): Promise<{ path: string; status: ChangedFile["status"]; hunks: Hunk[]; additions: number; deletions: number; binary: boolean; tooLarge: boolean } | null> {
	const [oldBlob, newBlob] = await Promise.all([readPath(range.oldRepo, range.base, path), readPath(range.newRepo, range.head, path)]);
	if (!oldBlob && !newBlob) return null;
	const status: ChangedFile["status"] = !oldBlob ? "added" : !newBlob ? "deleted" : "modified";
	const read = async (b: Blob | null) => {
		if (!b) return { text: "", binary: false, tooLarge: false };
		if (b.size > MAX_TEXT) return { text: "", binary: false, tooLarge: true };
		const bytes = new Uint8Array(await b.arrayBuffer());
		return isBinary(bytes) ? { text: "", binary: true, tooLarge: false } : { text: new TextDecoder().decode(bytes), binary: false, tooLarge: false };
	};
	const [o, n] = await Promise.all([read(oldBlob), read(newBlob)]);
	if (o.binary || n.binary || o.tooLarge || n.tooLarge) return { path, status, hunks: [], additions: 0, deletions: 0, binary: o.binary || n.binary, tooLarge: o.tooLarge || n.tooLarge };
	return { path, status, ...fileHunks(o.text, n.text), binary: false, tooLarge: false };
}
