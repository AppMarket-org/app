import type { Release, RepoExport } from "@appmarket/shared";
import { RELEASE_LIMITS } from "@appmarket/shared";
import { releaseUploadSchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { gitRemote, resolveTag } from "../artifacts/git.ts";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { canEdit, canView, isOwner } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { clientIp, rateLimit } from "../rate-limit.ts";
import { signDownload, verifyDownload } from "./signing.ts";
import { Releases } from "./store.ts";
import { logEvent } from "../observability/log.ts";
import { entitled } from "../payments/routes.ts";

type Ctx = { Variables: AuthVariables };
const repos = () => new RepoStore(env.DB);
const releases = () => new Releases(env.DB, env.RELEASES);
const LINK_TTL_SECONDS = 300;

/** Buyers only see releases of the published version; the owner and admins see all. */
function visible(release: Pick<Release, "tag">, repo: { publishedTag: string | null; state: string }, editor: boolean): boolean {
	return editor || (repo.state === "published" && release.tag === repo.publishedTag);
}

/** PRD R13: release binaries per repo. Mounted under /api/repos. */
export const repoReleaseRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/releases", async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session");
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		const editor = canEdit(repo, session);
		const items = (await releases().list(repo.id)).filter((r) => visible(r, repo, editor));
		return c.json({ items });
	})
	.post("/:owner/:slug/releases", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || !canView(repo, session)) return c.json({ error: "not_found" }, 404);
		if (!isOwner(repo, { id: session.user.id, orgIds: session.orgIds })) return c.json({ error: "forbidden" }, 403);
		if (repo.state === "removed") return c.json({ error: "removed" }, 409);
		const meta = releaseUploadSchema.safeParse(c.req.query());
		if (!meta.success) return c.json({ error: "invalid", issues: meta.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
		const size = Number(c.req.header("content-length"));
		if (!Number.isSafeInteger(size) || size <= 0) return c.json({ error: "length_required" }, 411);
		if (size > RELEASE_LIMITS.maxBytes) return c.json({ error: "too_large", maxBytes: RELEASE_LIMITS.maxBytes }, 413);
		// A release belongs to a version that exists in the repo's Git repository.
		if (!repo.gitRepo || !(await resolveTag(repo.gitRepo, meta.data.tag))) return c.json({ error: "tag_not_found", tag: meta.data.tag }, 422);
		const body = c.req.raw.body;
		if (!body) return c.json({ error: "empty" }, 400);
		const result = await releases().add(repo.id, session.user.id, meta.data, body, size);
		return result.ok ? c.json(result.release, 201) : c.json({ error: result.error }, result.status);
	})
	.delete("/:owner/:slug/releases/:id", requireRole(), async (c) => {
		const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		return (await releases().remove(repo.id, c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	});

const perUserOrIp = (c: Context<Ctx>) => c.get("session")?.user.id ?? `ip:${clientIp(c)}`;

/** PRD R14: signed, expiring download links (free repos in Phase 1). Mounted under /api/releases. */
export const releaseLinkRoutes = new Hono<Ctx>().post(
	"/:id/link",
	rateLimit<Ctx>(() => env.RL_DOWNLOAD_LINK, perUserOrIp, env.RATE_LIMIT_CONFIG.DOWNLOAD_LINK.period),
	async (c) => {
		const release = await releases().find(c.req.param("id"));
		const repo = release && (await repos().findById(release.repoId));
		const session = c.get("session");
		if (!release || !repo || !canView(repo, session) || !visible(release, repo, canEdit(repo, session))) {
			return c.json({ error: "not_found" }, 404);
		}
		// #33: APKs only after the developer declared Android developer verification for the package.
		if (release.platform === "android" && !repo.android) {
			return c.json({ error: "android_not_verified", message: "The developer has not confirmed Android developer verification for this app yet." }, 403);
		}
		// R17: paid repos need an entitlement check here before a link is issued.
		if (!(await entitled(repo, session))) return c.json({ error: "payment_required", message: "Buy this app to download it." }, 402);
		const expiresAt = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
		const sig = await signDownload(env.DOWNLOAD_SIGNING_KEY, release.id, expiresAt);
		logEvent("download.link_issued", { repo: repo.fullName, release: release.id });
		c.header("Cache-Control", "no-store");
		return c.json({ url: `/api/downloads/${release.id}?exp=${expiresAt}&sig=${sig}`, expiresAt: new Date(expiresAt * 1000).toISOString() });
	},
);

const ANDROID = /\.apk$/i;

/** PRD R14: serves the file for a valid signed link; supports Range for resumable downloads. Mounted under /api/downloads. */
export const downloadRoutes = new Hono<Ctx>().get("/:id", async (c) => {
	const id = c.req.param("id");
	const exp = Number(c.req.query("exp"));
	if (!(await verifyDownload(env.DOWNLOAD_SIGNING_KEY, id, exp, c.req.query("sig") ?? ""))) {
		return c.json({ error: "invalid_or_expired_link" }, 403);
	}
	const store = releases();
	const release = await store.find(id);
	if (!release) return c.json({ error: "not_found" }, 404);
	const range = c.req.header("range") ? c.req.raw.headers : undefined;
	const object = await store.object(release.r2_key, range);
	if (!object) return c.json({ error: "not_found" }, 404);
	// Count a download once per file, not per resumed chunk; the owner's export (#31) is not a download.
	if (c.req.query("export") !== "1" && (!range || /^bytes=0-/.test(c.req.header("range") ?? ""))) {
		logEvent("download.started", { release: id, platform: release.platform, size: object.size });
		c.executionCtx.waitUntil(store.countDownload(id));
	}

	const headers = new Headers({
		"Content-Type": ANDROID.test(release.filename) ? "application/vnd.android.package-archive" : "application/octet-stream",
		"Content-Disposition": `attachment; filename="${release.filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(release.filename)}`,
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff",
		"Accept-Ranges": "bytes",
		ETag: object.httpEtag,
		"X-Checksum-Sha256": release.sha256,
	});
	const r = "range" in object ? object.range : undefined;
	if (range && r && "offset" in r && r.offset !== undefined) {
		const length = r.length ?? object.size - r.offset;
		headers.set("Content-Range", `bytes ${r.offset}-${r.offset + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		return new Response(object.body, { status: 206, headers });
	}
	headers.set("Content-Length", String(object.size));
	return new Response(object.body, { status: 200, headers });
});

/** #31 (R25): the owner's export: Git remote and signed links to every release file (1 hour). Mounted under /api/repos. */
export const repoExportRoutes = new Hono<Ctx>().get("/:owner/:slug/export", requireRole(), async (c) => {
	const repo = await repos().findByPath(c.req.param("owner"), c.req.param("slug"));
	if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const files = await releases().list(repo.id);
	const releasesOut = await Promise.all(
		files.map(async (r) => ({
			tag: r.tag,
			platform: r.platform,
			filename: r.filename,
			sizeBytes: r.sizeBytes,
			sha256: r.sha256,
			url: `${env.PUBLIC_ORIGIN}/api/downloads/${r.id}?exp=${expiresAt}&sig=${await signDownload(env.DOWNLOAD_SIGNING_KEY, r.id, expiresAt)}&export=1`,
		})),
	);
	logEvent("repo.exported", { repo: repo.fullName, releases: files.length });
	c.header("Cache-Control", "no-store");
	return c.json({ repo: repo.fullName, gitRemote: repo.gitRepo ? await gitRemote(repo.gitRepo) : null, releases: releasesOut, expiresAt: new Date(expiresAt * 1000).toISOString() } satisfies RepoExport);
});
