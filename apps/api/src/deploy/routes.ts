import { deploymentRequestSchema } from "@appmarket/shared/schemas";
import { buildDeployConfig, CONTRACT_FILES } from "@appmarket/template-contract";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { readFiles } from "../artifacts/repos.ts";
import { cloudflareAccounts } from "../cloudflare/oauth.ts";
import { ListingRepository } from "../listings/repository.ts";
import { deploymentFor, deploymentsFor, insertDeployment } from "./store.ts";
import type { DeployParams } from "./workflow.ts";

type Ctx = { Variables: AuthVariables };

/** PRD D6: start a deploy of a listing's published version. Mounted under /api/listings. */
export const listingDeployRoutes = new Hono<Ctx>().post("/:slug/deployments", requireRole(), async (c) => {
	const request = deploymentRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!request.success) return c.json({ error: "invalid", issues: request.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
	const { accountId, workerName, secrets } = request.data;
	const userId = c.get("session")!.user.id;

	const listing = await new ListingRepository(env.DB).findBySlug(c.req.param("slug"));
	if (!listing || listing.state !== "published" || !listing.repoName || !listing.publishedTag || !listing.publishedCommit) return c.json({ error: "not_found" }, 404);
	// D4: paid listings deploy after purchase, which is not built yet.
	if (listing.priceCents > 0) return c.json({ error: "purchase_required" }, 402);

	const expected = listing.manifest?.secrets ?? [];
	const missing = expected.filter((name) => !secrets[name]);
	const unknown = Object.keys(secrets).filter((name) => !expected.includes(name));
	if (missing.length || unknown.length) return c.json({ error: "secrets_mismatch", missing, unknown }, 400);

	const accounts = await cloudflareAccounts(userId);
	if (!Array.isArray(accounts)) return c.json({ error: accounts }, 409);
	if (!accounts.some((a) => a.id === accountId)) return c.json({ error: "account_not_connected" }, 403);

	const plan = buildDeployConfig(await readFiles(listing.repoName, listing.publishedCommit, CONTRACT_FILES), workerName);
	if (!plan.ok) return c.json({ error: "not_deployable", reason: plan.reason }, 422);

	// R20: each deploy runs a build container. Counted here so fixing form errors is not limited.
	if (!(await env.RL_DEPLOY.limit({ key: userId })).success) {
		c.header("Retry-After", String(env.RATE_LIMIT_CONFIG.DEPLOY.period));
		return c.json({ error: "rate_limited", retryAfter: env.RATE_LIMIT_CONFIG.DEPLOY.period }, 429);
	}
	const id = crypto.randomUUID();
	await insertDeployment({ id, userId, listingId: listing.id, versionTag: listing.publishedTag, commitSha: listing.publishedCommit, accountId, workerName, deploy: plan.deploy, secrets });
	const params: DeployParams = {
		provider: "cloudflare-artifacts",
		providerData: { namespace: env.ARTIFACTS_NAMESPACE },
		event: { type: "tag" },
		owner: env.ARTIFACTS_NAMESPACE,
		repo: listing.repoName,
		sha: listing.publishedCommit,
		trigger: "tag",
		ref: `refs/tags/${listing.publishedTag}`,
		tag: listing.publishedTag,
		deploymentId: id,
	};
	await env.DEPLOY_WORKFLOW.create({ id, params });
	return c.json(await deploymentFor(userId, id), 202);
});

/** The signed-in user's deploys. Mounted under /api/deployments. */
export const deploymentRoutes = new Hono<Ctx>()
	.use(requireRole())
	.get("/", async (c) => c.json({ items: await deploymentsFor(c.get("session")!.user.id) }))
	.get("/:id", async (c) => {
		const deployment = await deploymentFor(c.get("session")!.user.id, c.req.param("id"));
		return deployment ? c.json(deployment) : c.json({ error: "not_found" }, 404);
	});
