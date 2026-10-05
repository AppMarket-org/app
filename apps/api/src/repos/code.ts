import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { listBranches, readDirectory, readPath, resolveRef } from "../artifacts/git.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { canEdit, canView } from "./access.ts";
import { pickBranch } from "./pick-branch.ts";
import { RepoStore } from "./repository.ts";

type Ctx = { Variables: AuthVariables };

const MAX_FILE = 1024 * 1024;
const SAFE_PATH = /^(?!.*(^|\/)\.\.(\/|$))[^\0]{0,1024}$/;

/**
 * Code browser. Everyone who can see the app reads its published version; owners and members can
 * also read any branch, tag or commit. Mounted under /api/repos.
 */
async function target(c: { req: { param(n: string): string | undefined; query(n: string): string | undefined }; get(k: "session"): AuthVariables["session"] }) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	const session = c.get("session");
	if (!repo?.gitRepo || !canView(repo, session)) return null;
	const editor = canEdit(repo, session);
	const asked = c.req.query("ref")?.trim();
	let commit: string | null = null;
	let ref: string;
	if (editor && asked) {
		commit = /^[0-9a-f]{40}$/.test(asked) ? asked : await resolveRef(repo.gitRepo, asked);
		ref = asked;
	} else if (!editor) {
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
	return { repo, editor, commit, ref };
}

export const codeRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/code/tree", async (c) => {
		const t = await target(c);
		if (!t) return c.json({ error: "not_found" }, 404);
		const path = (c.req.query("path") ?? "").replace(/^\/+|\/+$/g, "");
		if (!SAFE_PATH.test(path)) return c.json({ error: "invalid" }, 400);
		c.header("Cache-Control", t.editor ? "private, no-store" : "public, max-age=300");
		if (!t.commit) return c.json({ ref: t.ref, commit: null, path, entries: [], editor: t.editor, empty: true });
		const entries = await readDirectory(t.repo.gitRepo!, t.commit, path);
		if (!entries) return c.json({ error: "not_found" }, 404);
		return c.json({ ref: t.ref, commit: t.commit, path, editor: t.editor, entries: entries.map(({ name, type }) => ({ name, type })) });
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
		const t = await target(c);
		if (!t?.editor) return c.json({ error: "not_found" }, 404);
		const { defaultBranch, branches } = await listBranches(t.repo.gitRepo!);
		return c.json({ defaultBranch, branches: branches.map((b) => b.name).sort((a, b) => (a === defaultBranch ? -1 : b === defaultBranch ? 1 : a.localeCompare(b))) });
	});
