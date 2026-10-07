import { type PreviewSettings, previewWorkerName } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { cloudflareAccounts } from "../cloudflare/oauth.ts";
import { logEvent } from "../observability/log.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { markPreviewDeleted, previewStore } from "./store.ts";
import { accessToken } from "../cloudflare/oauth.ts";
import { listBranches } from "../artifacts/git.ts";
import { pickBranch } from "../repos/pick-branch.ts";
import { startPreview } from "./scan.ts";

type Ctx = { Variables: AuthVariables };

const deployNowSchema = z.object({
	workerName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
	accountId: z.string().regex(/^[0-9a-f]{32}$/),
	/** Keep redeploying the default branch on every push. */
	deployDefault: z.boolean().default(true),
	/** Previews of other branches; unchanged when left out. */
	previews: z.boolean().optional(),
});

const settingsSchema = z.object({
	enabled: z.boolean(),
	deployDefault: z.boolean().default(false),
	// A valid Worker name (lowercase letters, digits, dashes; at most 63).
	workerName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).optional(),
	accountId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

async function editable(c: { req: { param(name: string): string | undefined }; get(key: "session"): AuthVariables["session"] }) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	return repo && canEdit(repo, c.get("session")) ? repo : null;
}

/** #28 (R8): branch preview settings and status for owners and org members. Mounted under /api/repos. */
export const previewRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/previews", requireRole(), async (c) => {
		const repo = await editable(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const row = await previewStore.settings(repo.id);
		const name = row && (await env.DB.prepare('SELECT name FROM "user" WHERE id = ?').bind(row.user_id).first<{ name: string }>());
		const settings: PreviewSettings | null = row ? { enabled: !!row.enabled, deployDefault: !!row.deploy_default, workerName: row.worker_name, accountId: row.account_id, connectedBy: name?.name ?? "someone", mine: row.user_id === c.get("session")!.user.id } : null;
		const items = await previewStore.latest(repo.id);
		// #192: flag previews whose branch is gone, so they can be cleaned up.
		const branches = items.length && repo.gitRepo ? new Set((await listBranches(repo.gitRepo).catch(() => null))?.branches.map((b) => b.name) ?? items.map((p) => p.branch)) : null;
		return c.json({ settings, items: items.map((p) => ({ ...p, branchExists: branches ? branches.has(p.branch) : true })) });
	})
	// #192: delete one preview's Worker from the account it was deployed to (only Workers named by
	// the preview scheme, so the app itself is never touched). Resources stay; they are listed.
	.delete("/:owner/:slug/previews/:deploymentId", requireRole(), async (c) => {
		const repo = await editable(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const preview = (await previewStore.latest(repo.id)).find((p) => p.deploymentId === c.req.param("deploymentId"));
		if (!preview || preview.deleted) return c.json({ error: "not_found" }, 404);
		if (preview.workerName !== previewWorkerName(repo.slug, preview.branch)) return c.json({ error: "not_a_preview", message: "This is the deploy of the default branch, not a preview." }, 409);
		const row = await env.DB.prepare("SELECT user_id, account_id FROM deployments WHERE id = ?").bind(preview.deploymentId).first<{ user_id: string; account_id: string }>();
		// Only the connection that deployed it can delete it.
		if (row?.user_id !== c.get("session")!.user.id) return c.json({ error: "forbidden", message: "Only the person whose Cloudflare account has the preview can delete it." }, 403);
		const token = await accessToken(row.user_id);
		if (!token) return c.json({ error: "reconnect", message: "Reconnect your Cloudflare account first." }, 409);
		const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(row.account_id)}/workers/scripts/${encodeURIComponent(preview.workerName)}?force=true`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
		// Already gone counts as deleted.
		if (!response.ok && response.status !== 404) return c.json({ error: "cloudflare_error", message: `Cloudflare refused (HTTP ${response.status}).` }, 502);
		await markPreviewDeleted(preview.deploymentId);
		logEvent("previews.deleted", { repo: repo.fullName, branch: preview.branch, worker: preview.workerName });
		return c.json({ ok: true, resources: preview.resources });
	})
	// The first (or a repeated) deploy of the default branch's head, to the Worker and account
	// chosen, saving the automatic deploy settings with it.
	.post("/:owner/:slug/previews/deploy", requireRole(), async (c) => {
		const repo = await editable(c);
		if (!repo?.gitRepo) return c.json({ error: "not_found" }, 404);
		const input = deployNowSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid", message: "Choose a Cloudflare account and a valid Worker name." }, 400);
		const userId = c.get("session")!.user.id;
		const accounts = await cloudflareAccounts(userId);
		if (!Array.isArray(accounts)) return c.json({ error: accounts, message: "Connect your Cloudflare account first." }, 409);
		if (!accounts.some((a) => a.id === input.data.accountId)) return c.json({ error: "account_not_connected" }, 403);
		const { defaultBranch, branches } = await listBranches(repo.gitRepo);
		const head = pickBranch(defaultBranch, branches);
		if (!head) return c.json({ error: "empty", message: "Push a commit first." }, 409);
		const current = (await previewStore.latest(repo.id)).find((p) => p.branch === head.name);
		let id: string;
		let already = false;
		if (current && ["queued", "building", "deploying"].includes(current.status)) {
			id = current.deploymentId;
			already = true;
		} else {
			id = await startPreview({ repo_id: repo.id, user_id: userId, account_id: input.data.accountId, git_repo: repo.gitRepo, slug: repo.slug }, head.name, head.sha, input.data.workerName);
		}
		// Saved after the deploy is recorded, so the scheduled scan does not start the same commit again.
		const existing = await previewStore.settings(repo.id);
		await previewStore.save(repo.id, userId, input.data.accountId, { enabled: input.data.previews ?? !!existing?.enabled, deployDefault: input.data.deployDefault, workerName: input.data.workerName });
		logEvent("previews.deploy_now", { repo: repo.fullName, user: userId, deployment: id, already });
		return c.json({ id, branch: head.name, already }, already ? 200 : 201);
	})
	.put("/:owner/:slug/previews", requireRole(), async (c) => {
		const repo = await editable(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const input = settingsSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid" }, 400);
		if (!input.data.enabled && !input.data.deployDefault) {
			await previewStore.disable(repo.id);
			return c.json({ ok: true });
		}
		if (input.data.deployDefault && !input.data.workerName) return c.json({ error: "invalid", message: "Choose the Worker the default branch deploys to." }, 400);
		// Previews deploy with the signed-in user's own Cloudflare connection, into an account they chose.
		const userId = c.get("session")!.user.id;
		const accounts = await cloudflareAccounts(userId);
		if (!Array.isArray(accounts)) return c.json({ error: accounts, message: "Connect your Cloudflare account first." }, 409);
		if (!input.data.accountId || !accounts.some((a) => a.id === input.data.accountId)) return c.json({ error: "account_not_connected" }, 403);
		// The Worker name is kept with auto deploy off, so the default branch's deploy stays its Worker.
		await previewStore.save(repo.id, userId, input.data.accountId, { enabled: input.data.enabled, deployDefault: input.data.deployDefault, workerName: input.data.workerName ?? null });
		logEvent("previews.enabled", { repo: repo.fullName, user: userId, previews: input.data.enabled, deployDefault: input.data.deployDefault });
		return c.json({ ok: true });
	});
