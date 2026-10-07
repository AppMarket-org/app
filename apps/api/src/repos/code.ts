import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { listBranches, listRefs, readDirectory, readPath, resolveRef, sourceFiles } from "../artifacts/git.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { canBrowse, canEdit, canView } from "./access.ts";
import { pickBranch } from "./pick-branch.ts";
import { RepoStore } from "./repository.ts";

type Ctx = { Variables: AuthVariables };

const MAX_FILE = 1024 * 1024;
const SAFE_PATH = /^(?!.*(^|\/)\.\.(\/|$))[^\0]{0,1024}$/;

/**
 * Code browser. Owners and members read any branch, tag or commit, and so does everyone for a
 * public repo (#366, not a paid app); others read the published version. Visitors of a published app start at
 * that version. Mounted under /api/repos.
 */
async function target(c: { req: { param(n: string): string | undefined; query(n: string): string | undefined }; get(k: "session"): AuthVariables["session"] }) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	const session = c.get("session");
	if (!repo?.gitRepo || !canView(repo, session)) return null;
	const editor = canEdit(repo, session);
	const browse = canBrowse(repo, session);
	const asked = c.req.query("ref")?.trim();
	let commit: string | null = null;
	let ref: string;
	if (browse && asked) {
		commit = /^[0-9a-f]{40}$/.test(asked) ? asked : await resolveRef(repo.gitRepo, asked);
		ref = asked;
	} else if (!browse || (!editor && repo.state === "published" && repo.publishedCommit)) {
		commit = repo.publishedCommit;
		ref = repo.publishedTag ?? "";
	} else {
		// The default branch, or, when it has no commits (code pushed to master while the repo's
		// default is main, as `ng new` does), the first branch that has some.
		const { defaultBranch, branches } = await listBranches(repo.gitRepo);
		const pick = pickBranch(defaultBranch, branches);
		ref = pick?.name ?? defaultBranch;
		commit = pick?.sha ?? null;
	}
	return { repo, editor, browse, commit, ref };
}

export const codeRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/code/tree", async (c) => {
		const t = await target(c);
		if (!t) return c.json({ error: "not_found" }, 404);
		const path = (c.req.query("path") ?? "").replace(/^\/+|\/+$/g, "");
		if (!SAFE_PATH.test(path)) return c.json({ error: "invalid" }, 400);
		c.header("Cache-Control", t.editor ? "private, no-store" : "public, max-age=300");
		if (!t.commit) return c.json({ ref: t.ref, commit: null, path, entries: [], editor: t.editor, browse: t.browse, empty: true });
		const entries = await readDirectory(t.repo.gitRepo!, t.commit, path);
		if (!entries) return c.json({ error: "not_found" }, 404);
		return c.json({ ref: t.ref, commit: t.commit, path, editor: t.editor, browse: t.browse, entries: entries.map(({ name, type }) => ({ name, type })) });
	})
	.get("/:owner/:slug/code/files", async (c) => {
		const t = await target(c);
		if (!t) return c.json({ error: "not_found" }, 404);
		c.header("Cache-Control", t.editor ? "private, no-store" : "public, max-age=300");
		if (!t.commit) return c.json({ files: [], complete: true });
		const result = await sourceFiles(t.repo.gitRepo!, t.commit, { maxFiles: 5000, maxDirs: 2000, includeDependencies: true });
		return c.json({ files: result.files.slice(0, 5000).map((f) => f.path), complete: result.complete });
	})
	.get("/:owner/:slug/code/blob", async (c) => {
		const t = await target(c);
		const path = (c.req.query("path") ?? "").replace(/^\/+/, "");
		if (!t?.commit) return c.json({ error: "not_found" }, 404);
		if (!path || !SAFE_PATH.test(path)) return c.json({ error: "invalid" }, 400);
		const blob = await readPath(t.repo.gitRepo!, t.commit, path);
		if (!blob) return c.json({ error: "not_found" }, 404);
		c.header("Cache-Control", t.editor ? "private, no-store" : "public, max-age=300");
		if (blob.size > MAX_FILE) return c.json({ path, size: blob.size, tooLarge: true, binary: false, text: null });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		// A NUL byte in the first 8 KB means binary, as Git decides.
		const binary = bytes.subarray(0, 8192).includes(0);
		return c.json({ path, size: blob.size, tooLarge: false, binary, text: binary ? null : new TextDecoder().decode(bytes) });
	})
	.get("/:owner/:slug/code/branches", async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session");
		if (!repo?.gitRepo || !canBrowse(repo, session)) return c.json({ error: "not_found" }, 404);
		const { defaultBranch, refs } = await listRefs(repo.gitRepo);
		const names = Object.keys(refs);
		const branches = names.filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice(11));
		const tags = names.filter((ref) => ref.startsWith("refs/tags/")).map((ref) => ref.slice(10)).sort((a, b) => a.localeCompare(b));
		c.header("Cache-Control", "private, no-store");
		return c.json({ defaultBranch, branches: branches.sort((a, b) => (a === defaultBranch ? -1 : b === defaultBranch ? 1 : a.localeCompare(b))), tags });
	});
