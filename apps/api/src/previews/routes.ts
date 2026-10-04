import type { PreviewSettings } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { cloudflareAccounts } from "../cloudflare/oauth.ts";
import { logEvent } from "../observability/log.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { previewStore } from "./store.ts";

type Ctx = { Variables: AuthVariables };

const settingsSchema = z.object({ enabled: z.boolean(), accountId: z.string().regex(/^[0-9a-f]{32}$/).optional() });

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
		const settings: PreviewSettings | null = row ? { enabled: !!row.enabled, accountId: row.account_id, connectedBy: name?.name ?? "someone", mine: row.user_id === c.get("session")!.user.id } : null;
		return c.json({ settings, items: await previewStore.latest(repo.id) });
	})
	.put("/:owner/:slug/previews", requireRole(), async (c) => {
		const repo = await editable(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const input = settingsSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid" }, 400);
		if (!input.data.enabled) {
			await previewStore.disable(repo.id);
			return c.json({ ok: true });
		}
		// Previews deploy with the signed-in user's own Cloudflare connection, into an account they chose.
		const userId = c.get("session")!.user.id;
		const accounts = await cloudflareAccounts(userId);
		if (!Array.isArray(accounts)) return c.json({ error: accounts, message: "Connect your Cloudflare account first." }, 409);
		if (!input.data.accountId || !accounts.some((a) => a.id === input.data.accountId)) return c.json({ error: "account_not_connected" }, 403);
		await previewStore.save(repo.id, userId, input.data.accountId, true);
		logEvent("previews.enabled", { repo: repo.fullName, user: userId });
		return c.json({ ok: true });
	});
