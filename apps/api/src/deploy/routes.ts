import { CONFIG_NAME, CONFIG_VALUE_MAX, DEPLOY_UNAVAILABLE, type Deployment, deployAvailability, HOSTNAME, type WorkerConfig } from "@appmarket/shared";
import { deploymentRequestSchema } from "@appmarket/shared/schemas";
import { buildDeployConfig, CONTRACT_FILES } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { strictHit } from "../strict-limit.ts";
import { type Context, Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { readFiles } from "../artifacts/git.ts";
import { accessToken, cloudflareAccounts } from "../cloudflare/oauth.ts";
import { RepoStore } from "../repos/repository.ts";
import { readConfig, writeSecret, writeVar } from "./config.ts";
import { attachDomain, detachDomain, domainErrorMessage, listDomains, listZones } from "./domains.ts";
import { entitled } from "../payments/routes.ts";
import { runtimeLogs } from "./runtime-logs.ts";
import { deploymentFor, deploymentLogs, deploymentsFor, insertDeployment } from "./store.ts";
import { CloudflareApiError, rollbackTo, workerVersions } from "./versions.ts";
import type { DeployParams } from "./workflow.ts";
import { logEvent } from "../observability/log.ts";
import { startPreview } from "../previews/scan.ts";

type Ctx = { Variables: AuthVariables };

/** PRD D6: start a deploy of a repo's published version. Mounted under /api/repos. */
export const repoDeployRoutes = new Hono<Ctx>().post("/:owner/:slug/deployments", requireRole(), async (c) => {
	const request = deploymentRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!request.success) return c.json({ error: "invalid", issues: request.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
	const { accountId, workerName, secrets } = request.data;
	const userId = c.get("session")!.user.id;

	const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
	if (!repo || repo.state !== "published" || !repo.gitRepo || !repo.publishedTag || !repo.publishedCommit) return c.json({ error: "not_found" }, 404);
	// D4: the same rule the repo page uses to show the Deploy action.
	const availability = deployAvailability(repo, await entitled(repo, c.get("session")));
	if (!availability.ok) return availability.reason === "paid" ? c.json({ error: "purchase_required" }, 402) : c.json({ error: "not_deployable", reason: DEPLOY_UNAVAILABLE[availability.reason] }, 422);

	const expected = repo.manifest?.secrets ?? [];
	const missing = expected.filter((name) => !secrets[name]);
	const unknown = Object.keys(secrets).filter((name) => !expected.includes(name));
	if (missing.length || unknown.length) return c.json({ error: "secrets_mismatch", missing, unknown }, 400);

	const accounts = await cloudflareAccounts(userId);
	if (!Array.isArray(accounts)) return c.json({ error: accounts }, 409);
	if (!accounts.some((a) => a.id === accountId)) return c.json({ error: "account_not_connected" }, 403);

	const plan = buildDeployConfig(await readFiles(repo.gitRepo, repo.publishedCommit, CONTRACT_FILES), workerName);
	if (!plan.ok) return c.json({ error: "not_deployable", reason: plan.reason }, 422);

	// R20: each deploy runs a build container. Counted here so fixing form errors is not limited.
	const deployLimit = await strictHit("DEPLOY", userId);
	if (!deployLimit.success) {
		c.header("Retry-After", String(deployLimit.retryAfter));
		return c.json({ error: "rate_limited", retryAfter: deployLimit.retryAfter }, 429);
	}
	const id = crypto.randomUUID();
	await insertDeployment({ id, userId, repoId: repo.id, versionTag: repo.publishedTag, commitSha: repo.publishedCommit, accountId, workerName, deploy: plan.deploy, secrets });
	const params: DeployParams = {
		provider: "cloudflare-artifacts",
		providerData: { namespace: env.ARTIFACTS_NAMESPACE },
		event: { type: "tag" },
		owner: env.ARTIFACTS_NAMESPACE,
		repo: repo.gitRepo,
		sha: repo.publishedCommit,
		trigger: "tag",
		ref: `refs/tags/${repo.publishedTag}`,
		tag: repo.publishedTag,
		deploymentId: id,
	};
	await env.DEPLOY_WORKFLOW.create({ id, params });
	logEvent("deploy.started", { deployment: id, repo: repo.slug, version: repo.publishedTag, user: userId });
	return c.json(await deploymentFor(userId, id), 202);
});

/** The signed-in user's deploys. Mounted under /api/deployments. */
export const deploymentRoutes = new Hono<Ctx>()
	.use(requireRole())
	.get("/", async (c) => c.json({ items: await deploymentsFor(c.get("session")!.user.id) }))
	.get("/:id", async (c) => {
		const deployment = await deploymentFor(c.get("session")!.user.id, c.req.param("id"));
		return deployment ? c.json(deployment) : c.json({ error: "not_found" }, 404);
	})
	// #40 (D10): build and deploy output, kept with the deployment.
	.get("/:id/logs", async (c) => {
		const logs = await deploymentLogs(c.get("session")!.user.id, c.req.param("id"));
		return logs === undefined ? c.json({ error: "not_found" }, 404) : c.json({ logs });
	})
	// #40 (D10): runtime logs from Workers Logs in the buyer's account (last 15 minutes to 3 days).
	.get("/:id/runtime-logs", async (c) => {
		const minutes = Math.min(Math.max(Number(c.req.query("minutes")) || 60, 15), 3 * 24 * 60);
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			return c.json({ items: await runtimeLogs(fetch, target.token, target.deployment.accountId, target.deployment.workerName, minutes) });
		} catch (error) {
			if (error instanceof CloudflareApiError && error.status === 403) {
				return c.json({ error: "logs_not_allowed", message: "Reconnect Cloudflare and allow reading Workers Logs to see runtime logs here." }, 403);
			}
			return cloudflareError(c, error);
		}
	})
	// #51 (D13): plain variables (with values) and secrets (names only) of the deployed Worker.
	.get("/:id/config", async (c) => {
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			const [config, required, audit] = await Promise.all([
				readConfig(fetch, target.token, target.deployment.accountId, target.deployment.workerName),
				declaredSecrets(target.deployment.id),
				env.DB.prepare('SELECT a.kind, a.name, a.action, a.created_at, u.name AS user FROM deployment_config_audit a JOIN "user" u ON u.id = a.user_id WHERE a.deployment_id = ? ORDER BY a.id DESC LIMIT 20')
					.bind(target.deployment.id)
					.all<{ kind: string; name: string; action: string; created_at: string; user: string }>(),
			]);
			c.header("Cache-Control", "no-store");
			return c.json({ ...config, required, missing: required.filter((n) => !config.secrets.includes(n)), audit: audit.results } satisfies WorkerConfig & { audit: unknown[] });
		} catch (error) {
			return cloudflareError(c, error);
		}
	})
	.put("/:id/config/:kind{vars|secrets}/:name", async (c) => changeConfig(c, false))
	.delete("/:id/config/:kind{vars|secrets}/:name", async (c) => changeConfig(c, true))
	// #39 (D9): custom domains on the deployed Worker.
	.get("/:id/domains", async (c) => {
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			const [zones, domains] = await Promise.all([listZones(fetch, target.token, target.deployment.accountId), listDomains(fetch, target.token, target.deployment.accountId, target.deployment.workerName)]);
			return c.json({ zones, domains });
		} catch (error) {
			return cloudflareError(c, error);
		}
	})
	.post("/:id/domains", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { hostname?: unknown; zoneId?: unknown } | null;
		const hostname = typeof body?.hostname === "string" ? body.hostname.trim().toLowerCase().replace(/\.$/, "") : "";
		if (hostname.includes("*")) return c.json({ error: "invalid", message: "Wildcard hostnames cannot be custom domains; attach each hostname." }, 400);
		if (!HOSTNAME.test(hostname)) return c.json({ error: "invalid", message: "Enter a hostname such as app.example.com." }, 400);
		const zoneId = typeof body?.zoneId === "string" && /^[0-9a-f]{32}$/.test(body.zoneId) ? body.zoneId : undefined;
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			const domain = await attachDomain(fetch, target.token, target.deployment.accountId, target.deployment.workerName, hostname, zoneId);
			logEvent("deploy.domain_attached", { deployment: target.deployment.id, hostname });
			return c.json(domain, 201);
		} catch (error) {
			if (error instanceof CloudflareApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
				return c.json({ error: "domain_refused", message: domainErrorMessage(error, hostname) }, 422);
			}
			return cloudflareError(c, error);
		}
	})
	.delete("/:id/domains/:domainId", async (c) => {
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			// Only this Worker's domains: never detach something else in the buyer's account.
			const mine = await listDomains(fetch, target.token, target.deployment.accountId, target.deployment.workerName);
			if (!mine.some((d) => d.id === c.req.param("domainId"))) return c.json({ error: "not_found" }, 404);
			await detachDomain(fetch, target.token, target.deployment.accountId, c.req.param("domainId"));
			logEvent("deploy.domain_detached", { deployment: target.deployment.id });
			return c.json({ ok: true });
		} catch (error) {
			return cloudflareError(c, error);
		}
	})
	// The certificate is ready once the hostname answers over HTTPS.
	.get("/:id/domains/:domainId/status", async (c) => {
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		const domain = (await listDomains(fetch, target.token, target.deployment.accountId, target.deployment.workerName).catch(() => [])).find((d) => d.id === c.req.param("domainId"));
		if (!domain) return c.json({ error: "not_found" }, 404);
		const active = await fetch(`https://${domain.hostname}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) }).then(() => true, () => false);
		return c.json({ hostname: domain.hostname, active });
	})
	// #38 (D8): the Worker's version history in the buyer's account, and rollback to any version.
	.get("/:id/versions", async (c) => {
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			return c.json({ items: await workerVersions(fetch, target.token, target.deployment.accountId, target.deployment.workerName) });
		} catch (error) {
			return cloudflareError(c, error);
		}
	})
	// An automatic deploy (auto deploy or a branch preview) that failed: deploy the same branch and
	// commit again into the same Worker. Marketplace deploys are retried from the app page instead.
	.post("/:id/retry", async (c) => {
		const userId = c.get("session")!.user.id;
		const row = await env.DB.prepare(
			`SELECT d.status, d.preview_branch, d.commit_sha, d.worker_name, d.account_id, d.repo_id, r.git_repo, r.slug, r.state
			 FROM deployments d JOIN repos r ON r.id = d.repo_id WHERE d.id = ? AND d.user_id = ?`,
		)
			.bind(c.req.param("id"), userId)
			.first<{ status: string; preview_branch: string | null; commit_sha: string | null; worker_name: string; account_id: string; repo_id: string; git_repo: string | null; slug: string; state: string }>();
		if (!row) return c.json({ error: "not_found" }, 404);
		if (!row.preview_branch || !row.commit_sha) return c.json({ error: "invalid", message: "Deploy this app again from its page." }, 400);
		if (row.status !== "failed") return c.json({ error: "conflict", message: "Only a failed deploy can be tried again." }, 409);
		if (!row.git_repo || row.state === "removed") return c.json({ error: "gone", message: "The repo no longer exists." }, 409);
		const running = await env.DB.prepare("SELECT id FROM deployments WHERE repo_id = ? AND preview_branch = ? AND status IN ('queued', 'building', 'deploying') LIMIT 1")
			.bind(row.repo_id, row.preview_branch)
			.first<{ id: string }>();
		if (running) return c.json({ id: running.id, already: true });
		const id = await startPreview({ repo_id: row.repo_id, user_id: userId, account_id: row.account_id, git_repo: row.git_repo, slug: row.slug }, row.preview_branch, row.commit_sha, row.worker_name);
		logEvent("deploy.retried", { from: c.req.param("id"), deployment: id });
		return c.json({ id }, 201);
	})
	.post("/:id/rollback", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { versionId?: unknown } | null;
		const versionId = typeof body?.versionId === "string" && /^[0-9a-f-]{36}$/.test(body.versionId) ? body.versionId : null;
		if (!versionId) return c.json({ error: "invalid_version" }, 400);
		const target = await cloudflareTarget(c);
		if (target instanceof Response) return target;
		try {
			await rollbackTo(fetch, target.token, target.deployment.accountId, target.deployment.workerName, versionId);
		} catch (error) {
			return cloudflareError(c, error);
		}
		logEvent("deploy.rolled_back", { deployment: target.deployment.id, version: versionId });
		return c.json({ ok: true });
	});

/** The user's succeeded deployment and a Cloudflare token for it, or the error response. */
async function cloudflareTarget(c: Context<Ctx>): Promise<{ deployment: Deployment; token: string } | Response> {
	const userId = c.get("session")!.user.id;
	const deployment = await deploymentFor(userId, c.req.param("id")!);
	if (!deployment) return c.json({ error: "not_found" }, 404);
	if (deployment.status !== "succeeded") return c.json({ error: "not_deployed", message: "This deploy did not finish, so there is nothing to roll back." }, 409);
	const token = await accessToken(userId);
	if (!token) return c.json({ error: "reconnect", message: "Reconnect your Cloudflare account to see its versions." }, 409);
	return { deployment, token };
}

function cloudflareError(c: Context<Ctx>, error: unknown): Response {
	if (!(error instanceof CloudflareApiError)) throw error;
	logEvent("deploy.cloudflare_api_failed", { status: error.status, message: error.message.slice(0, 200) }, "warn");
	const message = error.status === 404 ? "The Worker no longer exists in your Cloudflare account." : error.status === 403 ? "Your Cloudflare connection is not allowed to do that; reconnect it." : `Cloudflare said: ${error.message}`;
	return c.json({ error: "cloudflare_error", message }, error.status === 404 ? 404 : 502);
}

/** Secrets the deployed app declares (its published manifest). */
async function declaredSecrets(deploymentId: string): Promise<string[]> {
	const row = await env.DB.prepare("SELECT r.published_manifest FROM deployments d JOIN repos r ON r.id = d.repo_id WHERE d.id = ?").bind(deploymentId).first<{ published_manifest: string | null }>();
	return row?.published_manifest ? ((JSON.parse(row.published_manifest) as { secrets?: string[] }).secrets ?? []) : [];
}

/** #51: set or delete one variable or secret; the value goes to Cloudflare only, the audit keeps the name. */
async function changeConfig(c: Context<Ctx>, remove: boolean): Promise<Response> {
	const kind = c.req.param("kind") === "secrets" ? "secret" : "var";
	const name = c.req.param("name")!;
	if (!CONFIG_NAME.test(name)) return c.json({ error: "invalid", message: "Use letters, digits and underscores, not starting with a digit." }, 400);
	let value: string | null = null;
	if (!remove) {
		const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
		if (typeof body?.value !== "string" || new TextEncoder().encode(body.value).length > CONFIG_VALUE_MAX) return c.json({ error: "invalid", message: "A value of at most 5 KB." }, 400);
		value = body.value;
	}
	const target = await cloudflareTarget(c);
	if (target instanceof Response) return target;
	const { accountId, workerName, id } = target.deployment;
	try {
		if (kind === "secret") await writeSecret(fetch, target.token, accountId, workerName, name, value);
		else await writeVar(fetch, target.token, accountId, workerName, name, value);
	} catch (error) {
		return cloudflareError(c, error);
	}
	await env.DB.prepare("INSERT INTO deployment_config_audit (deployment_id, user_id, kind, name, action) VALUES (?, ?, ?, ?, ?)").bind(id, c.get("session")!.user.id, kind, name, remove ? "delete" : "set").run();
	logEvent("deploy.config_changed", { deployment: id, kind, name, action: remove ? "delete" : "set" });
	return c.json({ ok: true });
}
