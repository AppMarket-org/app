import { env } from "cloudflare:workers";
import { listBranches } from "../artifacts/git.ts";
import { logEvent } from "../observability/log.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import { type CodeSymbol, languageOf, parseFile, resolveImport } from "./parse.ts";

const MAX_FILES = 3000;
const MAX_BYTES = 256 * 1024;
const MAX_DIRS = 1500;

export interface IndexInfo {
	commit: string;
	branch: string;
	files: number;
	complete: boolean;
	indexedAt: string;
}

const info = (repoId: string) =>
	env.DB.prepare(`SELECT commit_sha AS "commit", branch, files, complete, indexed_at AS "indexedAt" FROM code_index WHERE repo_id = ?`)
		.bind(repoId)
		.first<{ commit: string; branch: string; files: number; complete: number; indexedAt: string }>()
		.then((r) => (r ? { ...r, complete: r.complete === 1 } : null));

export const indexInfo = (repoId: string): Promise<IndexInfo | null> => info(repoId);

/** The graph of the default branch's head, rebuilt when the head moved. */
export async function ensureIndex(repo: { id: string; gitRepo: string }): Promise<IndexInfo | null> {
	const { defaultBranch, branches } = await listBranches(repo.gitRepo);
	const head = pickBranch(defaultBranch, branches);
	if (!head) return null;
	const current = await info(repo.id);
	if (current?.commit === head.sha) return current;
	return build(repo, head.name, head.sha);
}

/** Runs `n` statements per D1 batch. */
async function batched(statements: D1PreparedStatement[], n = 50): Promise<void> {
	for (let i = 0; i < statements.length; i += n) await env.DB.batch(statements.slice(i, i + n));
}

/** Multi-row INSERTs within D1's 100 bound variables per statement. */
function inserts(table: string, cols: string[], rows: unknown[][]): D1PreparedStatement[] {
	const per = Math.floor(100 / cols.length);
	const out: D1PreparedStatement[] = [];
	for (let i = 0; i < rows.length; i += per) {
		const chunk = rows.slice(i, i + per);
		out.push(env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`).bind(...chunk.flat()));
	}
	return out;
}

async function build(repo: { id: string; gitRepo: string }, branch: string, commit: string): Promise<IndexInfo> {
	const started = Date.now();
	using git = await env.ARTIFACTS.get(repo.gitRepo);
	const meta = await git.readCommit(commit);
	const all: { path: string; hash: string }[] = [];
	let complete = true;
	const queue = meta ? [{ prefix: "", hash: meta.treeHash }] : [];
	let dirs = 0;
	while (queue.length) {
		if (++dirs > MAX_DIRS) {
			complete = false;
			break;
		}
		const { prefix, hash } = queue.shift()!;
		for (const e of (await git.readTree(hash)) ?? []) {
			if (e.type === "tree") {
				if (!/^(\.git|node_modules|dist|build|vendor|\.venv|venv|__pycache__)$/.test(e.name)) queue.push({ prefix: `${prefix}${e.name}/`, hash: e.hash });
			} else if (e.type === "blob" && languageOf(prefix + e.name)) all.push({ path: prefix + e.name, hash: e.hash });
		}
	}
	if (all.length > MAX_FILES) complete = false;
	const files = all.slice(0, MAX_FILES);
	const paths = new Set(files.map((f) => f.path));
	const symbols: (CodeSymbol & { path: string })[] = [];
	const edges: [string, string][] = [];
	for (let i = 0; i < files.length; i += 16) {
		await Promise.all(
			files.slice(i, i + 16).map(async (f) => {
				const blob = await git.readBlob(f.hash);
				if (!blob || blob.size > MAX_BYTES) return;
				const parsed = parseFile(f.path, await blob.text());
				if (!parsed) return;
				for (const s of parsed.symbols) symbols.push({ ...s, path: f.path });
				for (const spec of parsed.imports) {
					const target = resolveImport(f.path, spec, paths);
					if (target && target !== f.path) edges.push([f.path, target]);
				}
			}),
		);
	}
	await batched([
		env.DB.prepare("DELETE FROM code_symbols WHERE repo_id = ?").bind(repo.id),
		env.DB.prepare("DELETE FROM code_imports WHERE repo_id = ?").bind(repo.id),
		env.DB.prepare("DELETE FROM code_files WHERE repo_id = ?").bind(repo.id),
		...inserts("code_files", ["repo_id", "path"], files.map((f) => [repo.id, f.path])),
		...inserts("code_symbols", ["repo_id", "path", "name", "kind", "line", "exported"], symbols.map((s) => [repo.id, s.path, s.name, s.kind, s.line, s.exported ? 1 : 0])),
		...inserts("code_imports", ["repo_id", "path", "target"], edges.map(([a, b]) => [repo.id, a, b])),
		env.DB.prepare(
			"INSERT INTO code_index (repo_id, commit_sha, branch, files, complete) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo_id) DO UPDATE SET commit_sha = excluded.commit_sha, branch = excluded.branch, files = excluded.files, complete = excluded.complete, indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
		).bind(repo.id, commit, branch, files.length, complete ? 1 : 0),
	]);
	logEvent("codegraph.indexed", { repo: repo.id, files: files.length, symbols: symbols.length, imports: edges.length, ms: Date.now() - started, complete });
	return (await info(repo.id))!;
}

export interface SymbolHit {
	path: string;
	name: string;
	kind: string;
	line: number;
	exported: boolean;
}

/** Definitions by exact name, then by prefix. */
export async function findSymbols(repoId: string, q: string, limit = 50): Promise<SymbolHit[]> {
	const { results } = await env.DB.prepare(
		"SELECT path, name, kind, line, exported FROM code_symbols WHERE repo_id = ? AND (name = ? OR name LIKE ? ESCAPE '\\') ORDER BY name = ? DESC, exported DESC, name, path LIMIT ?",
	)
		.bind(repoId, q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, q, limit)
		.all<{ path: string; name: string; kind: string; line: number; exported: number }>();
	return results.map((r) => ({ ...r, exported: r.exported === 1 }));
}

/** Files that import `path` directly, and the files `path` imports. */
export async function references(repoId: string, path: string): Promise<{ importedBy: string[]; imports: string[] }> {
	const [by, to] = await Promise.all([
		env.DB.prepare("SELECT path FROM code_imports WHERE repo_id = ? AND target = ? ORDER BY path LIMIT 500").bind(repoId, path).all<{ path: string }>(),
		env.DB.prepare("SELECT target FROM code_imports WHERE repo_id = ? AND path = ? ORDER BY target LIMIT 500").bind(repoId, path).all<{ target: string }>(),
	]);
	return { importedBy: by.results.map((r) => r.path), imports: to.results.map((r) => r.target) };
}

/** Indexed files at or under the given paths (a directory ends in /). */
export async function expandPaths(repoId: string, paths: string[]): Promise<string[]> {
	const out = new Set<string>();
	for (const p of paths) {
		const dir = p.endsWith("/") ? p : `${p}/`;
		const { results } = await env.DB.prepare("SELECT path FROM code_files WHERE repo_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\') LIMIT 2000")
			.bind(repoId, p.replace(/\/$/, ""), `${dir.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
			.all<{ path: string }>();
		for (const r of results) out.add(r.path);
	}
	return [...out];
}

/** What a change to `paths` can affect: files importing them, transitively (depth 3, up to 300). */
export async function impactOf(repoId: string, paths: string[]): Promise<{ path: string; depth: number; via: string }[]> {
	const seen = new Map<string, { depth: number; via: string }>();
	let frontier = await expandPaths(repoId, paths);
	const start = new Set(frontier);
	for (let depth = 1; depth <= 3 && frontier.length && seen.size < 300; depth++) {
		const next: string[] = [];
		for (let i = 0; i < frontier.length; i += 90) {
			const chunk = frontier.slice(i, i + 90);
			const { results } = await env.DB.prepare(`SELECT path, target FROM code_imports WHERE repo_id = ? AND target IN (${chunk.map(() => "?").join(",")})`)
				.bind(repoId, ...chunk)
				.all<{ path: string; target: string }>();
			for (const r of results) {
				if (start.has(r.path) || seen.has(r.path)) continue;
				seen.set(r.path, { depth, via: r.target });
				next.push(r.path);
			}
		}
		frontier = next;
	}
	return [...seen].map(([path, v]) => ({ path, ...v })).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}

/** Direct import neighbours of the files (both directions), for lease hints. */
export async function neighbours(repoId: string, files: string[]): Promise<Map<string, { other: string; relation: "imports" | "imported by" }[]>> {
	const out = new Map<string, { other: string; relation: "imports" | "imported by" }[]>();
	for (let i = 0; i < files.length; i += 45) {
		const chunk = files.slice(i, i + 45);
		const marks = chunk.map(() => "?").join(",");
		const { results } = await env.DB.prepare(`SELECT path, target FROM code_imports WHERE repo_id = ? AND (path IN (${marks}) OR target IN (${marks}))`)
			.bind(repoId, ...chunk, ...chunk)
			.all<{ path: string; target: string }>();
		for (const r of results) {
			if (chunk.includes(r.path)) out.set(r.path, [...(out.get(r.path) ?? []), { other: r.target, relation: "imports" }]);
			if (chunk.includes(r.target)) out.set(r.target, [...(out.get(r.target) ?? []), { other: r.path, relation: "imported by" }]);
		}
	}
	return out;
}

/** The whole graph for drawing it: every indexed file with its number of symbols, and the imports between them. */
export async function graphMap(repoId: string): Promise<{ files: { path: string; symbols: number }[]; edges: [string, string][] }> {
	const [files, edges] = await env.DB.batch<{ path?: string; n?: number; target?: string }>([
		env.DB.prepare("SELECT f.path, (SELECT COUNT(*) FROM code_symbols s WHERE s.repo_id = f.repo_id AND s.path = f.path) AS n FROM code_files f WHERE f.repo_id = ? ORDER BY f.path").bind(repoId),
		env.DB.prepare("SELECT path, target FROM code_imports WHERE repo_id = ?").bind(repoId),
	]);
	return {
		files: (files!.results ?? []).map((r) => ({ path: r.path!, symbols: r.n ?? 0 })),
		edges: (edges!.results ?? []).map((r) => [r.path!, r.target!] as [string, string]),
	};
}

/** One file's definitions, in line order. */
export async function symbolsIn(repoId: string, path: string): Promise<SymbolHit[]> {
	const { results } = await env.DB.prepare("SELECT path, name, kind, line, exported FROM code_symbols WHERE repo_id = ? AND path = ? ORDER BY line LIMIT 500")
		.bind(repoId, path)
		.all<{ path: string; name: string; kind: string; line: number; exported: number }>();
	return results.map((r) => ({ ...r, exported: r.exported === 1 }));
}
