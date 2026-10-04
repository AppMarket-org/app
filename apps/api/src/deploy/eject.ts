import { buildEjectGuide } from "@appmarket/shared";
import { CONTRACT_FILES, ejectConfig } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { readBlobBytes, readFiles, sourceFiles } from "../artifacts/git.ts";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { logEvent } from "../observability/log.ts";
import { signDownload, verifyDownload } from "../releases/signing.ts";
import { tarEnd, tarEntry } from "./tar.ts";

type Ctx = { Variables: AuthVariables };

const MAX_BYTES = 200 * 1024 * 1024;
const LINK_SECONDS = 3600;
const WRANGLER_FILES = new Set(["wrangler.json", "wrangler.jsonc", "wrangler.toml"]);

interface EjectRow {
	id: string;
	user_id: string;
	commit_sha: string;
	version_tag: string;
	worker_name: string;
	status: string;
	git_repo: string | null;
	slug: string;
	full_name: string;
}

const load = (id: string) =>
	env.DB.prepare(
		`SELECT d.id, d.user_id, d.commit_sha, d.version_tag, d.worker_name, d.status, r.git_repo, r.slug, o.handle || '/' || r.slug AS full_name
		 FROM deployments d JOIN repos r ON r.id = d.repo_id JOIN owners o ON o.id = r.owner_id WHERE d.id = ?`,
	)
		.bind(id)
		.first<EjectRow>();

async function prepare(row: EjectRow) {
	const result = ejectConfig(await readFiles(row.git_repo!, row.commit_sha, CONTRACT_FILES), row.worker_name);
	if (!result.ok) return result;
	const wranglerJson = `${JSON.stringify(result.config, null, 2)}\n`;
	return { ok: true as const, wranglerJson, guide: buildEjectGuide({ repo: row.full_name, version: row.version_tag, commit: row.commit_sha, folder: row.slug, d1Bindings: result.d1Bindings }) };
}

/** #41 (D11): eject a deploy: the exact deployed source plus a wrangler.json for its Worker. Mounted under /api/deployments. */
export const ejectRoutes = new Hono<Ctx>().get("/:id/eject", requireRole(), async (c) => {
	const row = await load(c.req.param("id"));
	if (!row || row.user_id !== c.get("session")!.user.id || !row.git_repo) return c.json({ error: "not_found" }, 404);
	if (row.status !== "succeeded") return c.json({ error: "not_deployed", message: "Only a finished deploy can be ejected." }, 409);
	const prepared = await prepare(row);
	if (!prepared.ok) return c.json({ error: "not_ejectable", message: prepared.reason }, 422);
	const expiresAt = Math.floor(Date.now() / 1000) + LINK_SECONDS;
	const sig = await signDownload(env.DOWNLOAD_SIGNING_KEY, `eject:${row.id}`, expiresAt);
	c.header("Cache-Control", "no-store");
	return c.json({
		repo: row.full_name,
		version: row.version_tag,
		commit: row.commit_sha,
		wranglerJson: prepared.wranglerJson,
		guide: prepared.guide,
		downloadUrl: `/api/eject/${row.id}?exp=${expiresAt}&sig=${sig}`,
		expiresAt: new Date(expiresAt * 1000).toISOString(),
	});
});

/** #41: streams the signed archive: <slug>/ with the source at the deployed commit, wrangler.json and EJECT.md. Mounted under /api/eject. */
export const ejectDownloadRoutes = new Hono<Ctx>().get("/:id", async (c) => {
	const id = c.req.param("id");
	if (!(await verifyDownload(env.DOWNLOAD_SIGNING_KEY, `eject:${id}`, Number(c.req.query("exp")), c.req.query("sig") ?? ""))) return c.json({ error: "invalid_or_expired_link" }, 403);
	const row = await load(id);
	if (!row?.git_repo || row.status !== "succeeded") return c.json({ error: "not_found" }, 404);
	const prepared = await prepare(row);
	if (!prepared.ok) return c.json({ error: "not_ejectable", message: prepared.reason }, 422);
	const { files, complete } = await sourceFiles(row.git_repo, row.commit_sha);
	if (!complete) return c.json({ error: "too_large", message: "This repo is too large to download here; use “Use this template” to get a full copy instead." }, 413);

	const gitRepo = row.git_repo;
	const now = Date.now();
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const write = async () => {
		const writer = writable.getWriter();
		let total = 0;
		try {
			const put = async (parts: Uint8Array[]) => {
				for (const p of parts) await writer.write(p);
			};
			await put(tarEntry(`${row.slug}/wrangler.json`, encoder.encode(prepared.wranglerJson), now));
			await put(tarEntry(`${row.slug}/EJECT.md`, encoder.encode(prepared.guide), now));
			for (const f of files) {
				if (WRANGLER_FILES.has(f.path) || f.path === "EJECT.md" || f.mode === "120000") continue;
				const bytes = await readBlobBytes(gitRepo, f.hash);
				if (!bytes) continue;
				total += bytes.length;
				if (total > MAX_BYTES) throw new Error("archive too large");
				await put(tarEntry(`${row.slug}/${f.path}`, bytes, now, f.mode === "100755" ? 0o755 : 0o644));
			}
			await writer.write(tarEnd());
			await writer.close();
			logEvent("deploy.ejected", { deployment: id, files: files.length, bytes: total });
		} catch (error) {
			logEvent("deploy.eject_failed", { deployment: id, error: error instanceof Error ? error.message : String(error) }, "warn");
			await writer.abort(error);
		}
	};
	c.executionCtx.waitUntil(write());
	return new Response(readable.pipeThrough(new CompressionStream("gzip")), {
		headers: {
			"Content-Type": "application/gzip",
			"Content-Disposition": `attachment; filename="${row.slug}-${row.version_tag.replace(/[^A-Za-z0-9._-]/g, "_")}.tar.gz"`,
			"Cache-Control": "private, no-store",
		},
	});
});
