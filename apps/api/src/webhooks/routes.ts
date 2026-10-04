import type { RepoWebhook } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { listRefs, mintGitToken } from "../artifacts/git.ts";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { decryptToken, encryptToken } from "../cloudflare/crypto.ts";
import { logEvent } from "../observability/log.ts";
import { isOwner } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { changedRefs, deliveryRequest, type PushEvent, type WebhookFormat, webhookUrlProblem } from "./core.ts";

type Ctx = { Variables: AuthVariables };

const MAX_WEBHOOKS = 5;
const BATCH = 20;
const aad = (id: string) => `webhook:${id}`;

interface WebhookRow {
	id: string;
	repo_id: string;
	url: string;
	format: WebhookFormat;
	secret_enc: string;
	github_token_enc: string | null;
	refs: string | null;
}

async function ownedRepo(c: { req: { param(n: string): string | undefined }; get(k: "session"): AuthVariables["session"] }) {
	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner")!, c.req.param("slug")!);
	const session = c.get("session")!;
	// Webhooks hand out read tokens to outside systems: owners (and org members of org repos) only.
	return repo && repo.state !== "removed" && isOwner(repo, { id: session.user.id, orgIds: session.orgIds }) ? repo : null;
}

const randomSecret = () => `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, (ch) => ({ "+": "-", "/": "_", "=": "" })[ch]!)}`;

/** #34: push webhooks for a repo. Mounted under /api/repos. */
export const webhookRoutes = new Hono<Ctx>()
	.get("/:owner/:slug/webhooks", requireRole(), async (c) => {
		const repo = await ownedRepo(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		const { results: hooks } = await env.DB.prepare("SELECT id, url, format, created_at FROM repo_webhooks WHERE repo_id = ? ORDER BY created_at").bind(repo.id).all<{ id: string; url: string; format: WebhookFormat; created_at: string }>();
		const items: RepoWebhook[] = await Promise.all(
			hooks.map(async (h) => ({
				id: h.id,
				url: h.url,
				format: h.format,
				createdAt: h.created_at,
				deliveries: (
					await env.DB.prepare("SELECT id, ref, sha, status, error, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 10")
						.bind(h.id)
						.all<{ id: string; ref: string; sha: string; status: number | null; error: string | null; created_at: string }>()
				).results.map((d) => ({ id: d.id, ref: d.ref, sha: d.sha, status: d.status, error: d.error, createdAt: d.created_at })),
			})),
		);
		return c.json({ items });
	})
	.post("/:owner/:slug/webhooks", requireRole(), async (c) => {
		const repo = await ownedRepo(c);
		if (!repo?.gitRepo) return c.json({ error: "not_found" }, 404);
		const body = (await c.req.json().catch(() => null)) as { url?: unknown; format?: unknown; githubToken?: unknown } | null;
		const format: WebhookFormat = body?.format === "github" ? "github" : "generic";
		const url = typeof body?.url === "string" ? body.url.trim() : "";
		const problem = webhookUrlProblem(url, format);
		if (problem) return c.json({ error: "invalid", issues: [{ path: "url", message: problem }] }, 400);
		const githubToken = typeof body?.githubToken === "string" ? body.githubToken.trim() : "";
		if (format === "github" && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/.test(githubToken)) {
			return c.json({ error: "invalid", issues: [{ path: "githubToken", message: "A GitHub fine-grained token with Contents: write on that repository (it sends repository_dispatch)." }] }, 400);
		}
		const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM repo_webhooks WHERE repo_id = ?").bind(repo.id).first<{ n: number }>();
		if ((count?.n ?? 0) >= MAX_WEBHOOKS) return c.json({ error: "too_many", message: `At most ${MAX_WEBHOOKS} webhooks per repo.` }, 409);
		const id = crypto.randomUUID();
		const secret = randomSecret();
		// The current refs are the baseline: only pushes after this are delivered.
		const { refs } = await listRefs(repo.gitRepo);
		await env.DB.prepare("INSERT INTO repo_webhooks (id, repo_id, url, format, secret_enc, github_token_enc, created_by, refs, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
			.bind(id, repo.id, url, format, await encryptToken(env.CF_TOKEN_ENCRYPTION_KEY, secret, aad(id)), githubToken ? await encryptToken(env.CF_TOKEN_ENCRYPTION_KEY, githubToken, aad(id)) : null, c.get("session")!.user.id, JSON.stringify(refs))
			.run();
		logEvent("webhook.created", { repo: repo.fullName, webhook: id, format, host: new URL(url).hostname });
		c.header("Cache-Control", "no-store");
		// The signing secret is shown once.
		return c.json({ id, url, format, secret: format === "generic" ? secret : null }, 201);
	})
	.delete("/:owner/:slug/webhooks/:id", requireRole(), async (c) => {
		const repo = await ownedRepo(c);
		if (!repo) return c.json({ error: "not_found" }, 404);
		await env.DB.batch([
			env.DB.prepare("DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM repo_webhooks WHERE id = ? AND repo_id = ?)").bind(c.req.param("id"), repo.id),
			env.DB.prepare("DELETE FROM repo_webhooks WHERE id = ? AND repo_id = ?").bind(c.req.param("id"), repo.id),
		]);
		return c.json({ ok: true });
	});

/** #34: runs every minute; delivers one event per new or moved branch or tag of watched repos. */
export async function scanWebhooks(): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT w.*, r.git_repo, o.handle || '/' || r.slug AS full_name FROM repo_webhooks w JOIN repos r ON r.id = w.repo_id JOIN owners o ON o.id = r.owner_id
		 WHERE r.state != 'removed' AND r.git_repo IS NOT NULL ORDER BY w.checked_at IS NOT NULL, w.checked_at LIMIT ?`,
	)
		.bind(BATCH)
		.all<WebhookRow & { git_repo: string; full_name: string }>();
	let delivered = 0;
	for (const hook of results) {
		await env.DB.prepare("UPDATE repo_webhooks SET checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(hook.id).run();
		try {
			const { remote, refs } = await listRefs(hook.git_repo);
			const changes = changedRefs(hook.refs ? (JSON.parse(hook.refs) as Record<string, string>) : {}, refs).slice(0, 10);
			// Store the new baseline first so a failing endpoint is not retried every minute.
			await env.DB.prepare("UPDATE repo_webhooks SET refs = ? WHERE id = ?").bind(JSON.stringify(refs), hook.id).run();
			if (!hook.refs || changes.length === 0) continue;
			const signing = await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, hook.secret_enc, aad(hook.id));
			const github = hook.github_token_enc ? await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, hook.github_token_enc, aad(hook.id)) : undefined;
			for (const change of changes) {
				const deliveryId = crypto.randomUUID();
				// A read token for this delivery: the CI clones without other credentials.
				const minted = await mintGitToken(hook.git_repo, "read", 3600);
				const event: PushEvent = { event: "push", deliveryId, repo: hook.full_name, ref: change.ref, before: change.before, after: change.after, remote, token: minted.token, tokenExpiresAt: minted.expiresAt, sentAt: new Date().toISOString() };
				let status: number | null = null;
				let error: string | null = null;
				try {
					const response = await fetch(await deliveryRequest(hook.format, hook.url, event, { signing, github }), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
					status = response.status;
					if (!response.ok) error = (await response.text().catch(() => "")).slice(0, 300) || `HTTP ${response.status}`;
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
				await env.DB.prepare("INSERT INTO webhook_deliveries (id, webhook_id, ref, sha, status, error) VALUES (?, ?, ?, ?, ?, ?)").bind(deliveryId, hook.id, change.ref, change.after, status, error).run();
				logEvent("webhook.delivered", { webhook: hook.id, ref: change.ref, status, ok: !error });
				delivered++;
			}
			await env.DB.prepare("DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50)").bind(hook.id, hook.id).run();
		} catch (error) {
			logEvent("webhook.scan_failed", { webhook: hook.id, error: error instanceof Error ? error.message : String(error) }, "warn");
		}
	}
	return delivered;
}
