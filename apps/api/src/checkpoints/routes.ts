import { CHECKPOINT_LIMITS, osFromUserAgent, type Checkpoint, type CheckpointVisibility, type Repo, summarizeSessions, type CheckpointRecord } from "@appmarket/shared";
import { checkpointPatchSchema, checkpointRecordSchema, checkpointTranscriptSchema, checkpointVisibilitySchema, sessionVisibilitySchema } from "@appmarket/shared/schemas";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { commitExists, commitLog, pushedCommits, resolveRef } from "../artifacts/git.ts";
import { commitEntries } from "./commits.ts";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { suggestFromCheckpoint } from "../memory/store.ts";
import { logEvent } from "../observability/log.ts";
import { canView, isOwner } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { priceRecord } from "./pricing.ts";
import { redactRecord } from "./redact.ts";
import { deleteTranscript, getTranscript, putTranscript, TRANSCRIPT_LIMIT } from "./transcripts.ts";
import { CheckpointStore, type CheckpointViewer } from "./store.ts";
import { OwnerStore } from "../owners/store.ts";

type Ctx = { Variables: AuthVariables };
const checkpoints = () => new CheckpointStore(env.DB);
const invalid = (error: z.ZodError) => ({ error: "invalid", issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) });
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

async function repoFor(c: Context<Ctx>): Promise<Repo | null> {
	return new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
}

/**
 * #124: Artifacts has no push events, so the first read after a push reconciles: checkpoints of
 * pushed commits become attached, and pushed commits without one get a `missing` placeholder.
 */
async function reconcilePushes(repo: Repo): Promise<void> {
	if (!repo.gitRepo) return;
	try {
		const store = checkpoints();
		const { commits } = await pushedCommits(repo.gitRepo);
		const head = commits[0]?.hash;
		// Only when the default branch moved since the last reconcile.
		if (!head || head === (await store.reconciledHead(repo.id))) return;
		const result = await store.reconcilePushed({ id: repo.id, defaultVisibility: repo.checkpointVisibility }, commits, new Date().toISOString());
		if (result.attached || result.missing) logEvent("checkpoint.reconciled", { repo: repo.fullName, ...result });
	} catch (error) {
		// Reading checkpoints must not fail because Artifacts is slow; the next read retries.
		logEvent("checkpoint.reconcile_failed", { repo: repo.fullName, error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * The API does not see pushes (they go straight to the Artifacts remote), so a pending checkpoint is
 * re-checked when it is read: at most 20 per request, in parallel.
 */
async function reconcile(repo: Repo, items: Checkpoint[]): Promise<Checkpoint[]> {
	const gitRepo = repo.gitRepo;
	const pending = items.filter((i) => i.state === "pending").slice(0, 20);
	if (!gitRepo || !pending.length) return items;
	const found = (await Promise.all(pending.map(async (i) => ((await commitExists(gitRepo, i.commit).catch(() => false)) ? i.commit : null)))).filter((sha): sha is string => !!sha);
	if (!found.length) return items;
	await checkpoints().attach(repo.id, found);
	return items.map((i) => (found.includes(i.commit) ? { ...i, state: "attached" } : i));
}

/** Owners (the user, or members of the owning org) see private checkpoints in full. */
function viewerOf(c: Context<Ctx>, repo: Repo): CheckpointViewer {
	const session = c.get("session");
	if (!session) return "public";
	// #135: admins see private checkpoints only through the logged admin view (with a report).
	return isOwner(repo, { id: session.user.id, orgIds: session.orgIds }) ? "owner" : "public";
}

function ownedBy(c: Context<Ctx>, repo: Repo): boolean {
	const session = c.get("session");
	return !!session && isOwner(repo, { id: session.user.id, orgIds: session.orgIds });
}

/** Checkpoints PRD (#111). Mounted under /api/repos: /:owner/:slug/checkpoints[/:sha]. */
export const checkpointRoutes = new Hono<Ctx>()
	.post("/:owner/:slug/checkpoints", requireRole(), async (c) => {
		const size = Number(c.req.header("content-length") ?? "0");
		if (size > CHECKPOINT_LIMITS.inlineBytes) return c.json({ error: "too_large", maxBytes: CHECKPOINT_LIMITS.inlineBytes }, 413);
		const repo = await repoFor(c);
		// Membership is checked on every upload: someone who left the org gets 404.
		if (!repo || !ownedBy(c, repo) || repo.state === "removed") return c.json({ error: "not_found" }, 404);
		const session = c.get("session")!;
		if (!(await env.RL_CHECKPOINT.limit({ key: session.session.id })).success) {
			c.header("Retry-After", String(env.RATE_LIMIT_CONFIG.CHECKPOINT.period));
			return c.json({ error: "rate_limited", retryAfter: env.RATE_LIMIT_CONFIG.CHECKPOINT.period }, 429);
		}
		const text = await c.req.text();
		if (new TextEncoder().encode(text).length > CHECKPOINT_LIMITS.inlineBytes) return c.json({ error: "too_large", maxBytes: CHECKPOINT_LIMITS.inlineBytes }, 413);
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return c.json({ error: "invalid_json" }, 400);
		}
		const parsed = checkpointRecordSchema.safeParse(body);
		if (!parsed.success) return c.json(invalid(parsed.error), 400);
		// #128: the server's own redaction pass, then #127 pricing, both before hashing so an
		// identical retry still matches.
		const redacted = redactRecord(parsed.data);
		const record = priceRecord(redacted.record);
		if (redacted.count) logEvent("checkpoint.server_redacted", { repo: repo.fullName, count: redacted.count, cli: c.req.header("user-agent") ?? "" }, "warn");
		const attached = repo.gitRepo ? await commitExists(repo.gitRepo, record.commit) : false;
		const device = (session.session as { deviceName?: string | null }).deviceName ?? null;
		// The OS from the CLI's user agent (or, for older CLIs, the one it signed in with).
		const os = osFromUserAgent(c.req.header("user-agent")) ?? osFromUserAgent((session.session as { userAgent?: string | null }).userAgent);
		const result = await checkpoints().put({ id: repo.id, path: repo.fullName }, record, {
			state: attached ? "attached" : "pending",
			visibility: repo.checkpointVisibility,
			uploadedBy: session.user.id,
			device,
			os,
			force: c.req.query("force") === "1",
			serverRedactions: redacted.count,
		});
		if (result.status === 409) return c.json({ error: "conflict", message: "A different checkpoint exists for this commit; retry with ?force=1 to replace it.", checkpoint: result.checkpoint }, 409);
		if (result.status === 201) {
			logEvent("checkpoint.created", { repo: repo.fullName, harness: record.harness, state: result.checkpoint.state, redactions: record.redactions });
			// #197: notes this session suggests for the repo's memory (people accept or dismiss them).
			c.executionCtx.waitUntil(suggestFromCheckpoint(repo.id, record.commit, record).catch((e: unknown) => logEvent("memory.suggest_failed", { repo: repo.fullName, error: String(e) }, "warn")));
		}
		return c.json(result.checkpoint, result.status);
	})
	// The commit history of a branch (default: the repo's default branch), each commit with the
	// prompts behind it where the viewer may see its checkpoint.
	.get("/:owner/:slug/commits", async (c) => {
		const repo = await repoFor(c);
		if (!repo?.gitRepo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const ref = c.req.query("ref") || null;
		const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
		const limit = 30;
		const head = ref ? await resolveRef(repo.gitRepo, ref) : null;
		if (ref && !head) return c.json({ error: "not_found", message: "No such branch, tag or commit." }, 404);
		const log = await commitLog(repo.gitRepo, head, offset, limit);
		const viewer = viewerOf(c, repo);
		const cps = await checkpoints().forCommits({ id: repo.id, path: repo.fullName }, log.commits.map((x) => x.hash), viewer);
		c.header("Cache-Control", c.get("session") ? "private, no-store" : "public, max-age=60");
		return c.json({ ref: ref ?? log.ref, items: commitEntries(log.commits, cps), next: log.commits.length === limit ? offset + limit : null });
	})
	.get("/:owner/:slug/checkpoints", async (c) => {
		const repo = await repoFor(c);
		if (!repo || !canView(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		await reconcilePushes(repo);
		const q = c.req.query();
		// view=public: what anyone sees (the server-rendered build history, even for the owner).
		const viewer = q.view === "public" ? "public" : viewerOf(c, repo);
		const page = await checkpoints().list({ id: repo.id, path: repo.fullName }, viewer, { before: q.before, branch: q.branch, session: q.session, limit: q.limit ? Number(q.limit) : undefined });
		return c.json({ ...page, items: await reconcile(repo, page.items) });
	})
	// #116: the repo's default for new checkpoints, and one visibility for a whole session.
	.put("/:owner/:slug/checkpoint-settings", requireRole(), async (c) => {
		const repo = await repoFor(c);
		if (!repo || !ownedBy(c, repo)) return c.json({ error: "not_found" }, 404);
		const body = checkpointVisibilitySchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		await checkpoints().setRepoDefault(repo.id, body.data.visibility);
		return c.json({ visibility: body.data.visibility });
	})
	// #130: preview before publishing a session: how many private checkpoints would become visible.
	// #71 (G6): what the latest agent sessions did, for the next session's context (owners and members:
	// it reads private checkpoints). Assembled from the newest 80 checkpoints.
	.get("/:owner/:slug/handoff", requireRole(), async (c) => {
		const repo = await repoFor(c);
		if (!repo || !ownedBy(c, repo)) return c.json({ error: "not_found" }, 404);
		const limit = Math.min(Math.max(Number(c.req.query("limit")) || 3, 1), 10);
		const { results } = await env.DB.prepare("SELECT record FROM checkpoints WHERE repo_id = ? ORDER BY created_at DESC LIMIT 80").bind(repo.id).all<{ record: string }>();
		const records = results.flatMap((r) => {
			try {
				return [JSON.parse(r.record) as CheckpointRecord];
			} catch {
				return [];
			}
		});
		c.header("Cache-Control", "private, no-store");
		return c.json({ sessions: summarizeSessions(records, limit) });
	})
	.get("/:owner/:slug/checkpoints/visibility-preview", requireRole(), async (c) => {
		const repo = await repoFor(c);
		const session = c.req.query("session") ?? "";
		if (!repo || !ownedBy(c, repo) || !session) return c.json({ error: "not_found" }, 404);
		return c.json({ becomingVisible: await checkpoints().privateInSession(repo.id, session) });
	})
	.post("/:owner/:slug/checkpoints/visibility", requireRole(), async (c) => {
		const repo = await repoFor(c);
		if (!repo || !ownedBy(c, repo)) return c.json({ error: "not_found" }, 404);
		const body = sessionVisibilitySchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json(invalid(body.error), 400);
		return c.json({ updated: await checkpoints().setSessionVisibility(repo.id, body.data.session, body.data.visibility) });
	})
	// #135: the developer's view of moderator access to their private checkpoints.
	.get("/:owner/:slug/checkpoints/access-log", requireRole(), async (c) => {
		const repo = await repoFor(c);
		if (!repo || !ownedBy(c, repo)) return c.json({ error: "not_found" }, 404);
		return c.json({ items: await checkpoints().accessLog(repo.id) });
	})
	.get("/:owner/:slug/checkpoints/:sha", async (c) => {
		const repo = await repoFor(c);
		const sha = c.req.param("sha");
		if (!repo || !canView(repo, c.get("session")) || !SHA.test(sha)) return c.json({ error: "not_found" }, 404);
		await reconcilePushes(repo);
		const checkpoint = await checkpoints().get({ id: repo.id, path: repo.fullName }, sha, viewerOf(c, repo));
		return checkpoint ? c.json((await reconcile(repo, [checkpoint]))[0]) : c.json({ error: "not_found" }, 404);
	})
	// #129: the full record of a truncated checkpoint, encrypted per account in R2.
	.post("/:owner/:slug/checkpoints/:sha/transcript", requireRole(), async (c) => {
		const repo = await repoFor(c);
		const sha = c.req.param("sha");
		if (!repo || !ownedBy(c, repo) || !SHA.test(sha)) return c.json({ error: "not_found" }, 404);
		if (Number(c.req.header("content-length") ?? "0") > TRANSCRIPT_LIMIT) return c.json({ error: "too_large", maxBytes: TRANSCRIPT_LIMIT }, 413);
		const text = await c.req.text();
		if (new TextEncoder().encode(text).length > TRANSCRIPT_LIMIT) return c.json({ error: "too_large", maxBytes: TRANSCRIPT_LIMIT }, 413);
		const parsed = checkpointTranscriptSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
		if (!parsed.success) return c.json(invalid(parsed.error), 400);
		if (parsed.data.commit !== sha) return c.json({ error: "invalid", issues: [{ path: "commit", message: "Does not match the checkpoint." }] }, 400);
		if (!(await checkpoints().get({ id: repo.id, path: repo.fullName }, sha, "owner"))) return c.json({ error: "not_found" }, 404);
		// The same server redaction pass as the record itself (#128).
		const { record } = redactRecord(parsed.data);
		const bytes = await putTranscript({ id: repo.id, ownerId: repo.owner.id }, sha, JSON.stringify(record));
		return c.json({ stored: true, bytes }, 201);
	})
	.get("/:owner/:slug/checkpoints/:sha/transcript", async (c) => {
		const repo = await repoFor(c);
		const sha = c.req.param("sha");
		if (!repo || !canView(repo, c.get("session")) || !SHA.test(sha)) return c.json({ error: "not_found" }, 404);
		// Follows the checkpoint's visibility: private ones only for owners.
		if (!(await checkpoints().get({ id: repo.id, path: repo.fullName }, sha, viewerOf(c, repo)))) return c.json({ error: "not_found" }, 404);
		const json = await getTranscript({ id: repo.id, ownerId: repo.owner.id }, sha);
		if (!json) return c.json({ error: "not_found" }, 404);
		return c.body(json, 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
	})
	.patch("/:owner/:slug/checkpoints/:sha", requireRole(), async (c) => {
		const repo = await repoFor(c);
		const sha = c.req.param("sha");
		if (!repo || !ownedBy(c, repo) || !SHA.test(sha)) return c.json({ error: "not_found" }, 404);
		const patch = checkpointPatchSchema.safeParse(await c.req.json().catch(() => null));
		if (!patch.success) return c.json(invalid(patch.error), 400);
		const store = checkpoints();
		if (patch.data.visibility && !(await store.setVisibility(repo.id, sha, patch.data.visibility as CheckpointVisibility))) return c.json({ error: "not_found" }, 404);
		if (patch.data.add_prompt && !(await store.addPrompt(repo.id, sha, patch.data.add_prompt))) return c.json({ error: "not_found" }, 404);
		return c.json(await store.get({ id: repo.id, path: repo.fullName }, sha, "owner"));
	})
	.delete("/:owner/:slug/checkpoints/:sha", requireRole(), async (c) => {
		const repo = await repoFor(c);
		const sha = c.req.param("sha");
		if (!repo || !ownedBy(c, repo) || !SHA.test(sha)) return c.json({ error: "not_found" }, 404);
		if (!(await checkpoints().delete(repo.id, sha))) return c.json({ error: "not_found" }, 404);
		// #131: deleting a checkpoint deletes its transcript too.
		await deleteTranscript(repo.id, sha);
		return c.json({ deleted: true });
	});

/** #128: admin audit: stored checkpoints that still contain a known secret format. Mounted under /api/admin. */
export const adminCheckpointRoutes = new Hono<Ctx>()
	.use(requireRole("admin"))
	.get("/checkpoints/audit", async (c) => c.json(await checkpoints().audit()))
	// #135: moderators see everything, including private checkpoints, only while handling an open
	// report on this repo; each page with private checkpoints is logged and shown to the developer.
	.get("/repos/:owner/:slug/checkpoints", async (c) => {
		const repo = await repoFor(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const reportId = c.req.query("report") ?? "";
		const report = await env.DB.prepare("SELECT id FROM repo_reports WHERE id = ? AND repo_id = ? AND resolved_at IS NULL").bind(reportId, repo.id).first<{ id: string }>();
		if (!report) return c.json({ error: "report_required", message: "Open a checkpoint view from an open report on this repo." }, 403);
		const page = await checkpoints().list({ id: repo.id, path: repo.fullName }, "owner", { before: c.req.query("before"), limit: 50 });
		const privateCount = page.items.filter((i) => i.visibility === "private").length;
		if (privateCount) {
			await checkpoints().logAccess(repo.id, c.get("session")!.user.id, report.id, privateCount);
			logEvent("checkpoints.moderator_access", { repo: repo.fullName, report: report.id, privateCount });
		}
		return c.json(page);
	});

/** #131: download every checkpoint of the account's repos (and organizations it owns) as JSONL. Mounted under /api/me. */
export const checkpointExportRoutes = new Hono<Ctx>().use(requireRole()).get("/checkpoints/export", async (c) => {
	const session = c.get("session")!;
	const owners = new OwnerStore(env.DB);
	const ownedOrgs = (await owners.membershipsOf(session.user.id)).filter((m) => m.role === "owner").map((m) => m.org.id);
	const lines = checkpoints().exportLines([session.user.id, ...ownedOrgs]);
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await lines.next();
			if (next.done) controller.close();
			else controller.enqueue(encoder.encode(next.value));
		},
	});
	logEvent("checkpoints.exported", { user: session.user.id });
	return new Response(body, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Content-Disposition": `attachment; filename="appmarket-checkpoints-${new Date().toISOString().slice(0, 10)}.jsonl"`,
			"Cache-Control": "private, no-store",
		},
	});
});
