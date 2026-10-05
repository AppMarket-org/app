import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { requireAccess } from "./auth/access.ts";
import { auth } from "./auth/auth.ts";
import { type AuthVariables, deviceAuthGate, requireRole, sessionMiddleware } from "./auth/middleware.ts";
import { adminRepoRoutes, repoRoutes, mediaRoutes } from "./repos/routes.ts";
import { adminCheckpointRoutes, checkpointExportRoutes, checkpointRoutes } from "./checkpoints/routes.ts";
import { scanContributions } from "./contributions/scan.ts";
import { backfillLanguages } from "./repos/languages.ts";
import { CheckpointStore } from "./checkpoints/store.ts";
import { deleteTranscript } from "./checkpoints/transcripts.ts";
import { logEvent } from "./observability/log.ts";
import { avatarMediaRoutes } from "./owners/avatars.ts";
import { cloudflareRoutes } from "./cloudflare/routes.ts";
import { cowbellRoutes, repoCowbellRoutes } from "./cowbells/routes.ts";
import { deploymentRoutes, repoDeployRoutes } from "./deploy/routes.ts";
import { adminReportRoutes, reportRoutes } from "./moderation/routes.ts";
import { ejectDownloadRoutes, ejectRoutes } from "./deploy/eject.ts";
import { ogRoutes } from "./og/routes.ts";
import { conformanceRoutes } from "./conformance/routes.ts";
import { codeRoutes } from "./repos/code.ts";
import { emailImpacts } from "./email/impacts.ts";
import { emailPreferenceRoutes, unsubscribeRoutes } from "./email/routes.ts";
import { a2aRoutes, planeRoutes } from "./plane/routes.ts";
import { codeGraphRoutes } from "./codegraph/routes.ts";
import { memoryRoutes } from "./memory/routes.ts";
import { pullRoutes } from "./pulls/routes.ts";
import { purgeRemovedRepoMemory } from "./memory/store.ts";
import { adminImpactRoutes, myImpactRoutes } from "./impacts/routes.ts";
import { syncOpenImpacts } from "./impacts/store.ts";
import { adminGraphRoutes, repoGraphRoutes } from "./graph/routes.ts";
import { backfillGraph } from "./graph/store.ts";
import { checkoutRoutes, ensureWebhookEndpoints, myPurchaseRoutes, paymentsAdminRoutes, payoutRoutes, stripeWebhookRoutes } from "./payments/routes.ts";
import { scanWebhooks, webhookRoutes } from "./webhooks/routes.ts";
import { agentSessionRoutes, repoSessionRoutes } from "./sessions/routes.ts";
import { previewRoutes } from "./previews/routes.ts";
import { scanPreviews } from "./previews/scan.ts";
import { downloadRoutes, repoExportRoutes, repoReleaseRoutes, releaseLinkRoutes } from "./releases/routes.ts";
import { clientIp } from "./rate-limit.ts";
import { strictLimit } from "./strict-limit.ts";
import { sitemap, sitemapPage } from "./routes/seo.ts";
import { onError } from "./observability/errors.ts";
import { legacyRoutes, meRoutes, orgRoutes, ownerRoutes, sessionRoutes } from "./owners/routes.ts";

// appmarket.org API. The Angular web Worker forwards /api/* and /sitemap.xml here via a service binding.
const api = new Hono<{ Variables: AuthVariables }>();

api.get("/health", (c) => c.json({ ok: true, env: env.APP_ENV }));

// R11: Better Auth handles sign-in, OAuth callbacks, sessions and sign-out under /api/auth/*.
api.post("/auth/sign-in/*", strictLimit("SIGN_IN", (c) => clientIp(c)));
// #132: device codes, 10 a minute per IP.
api.post("/auth/device/code", strictLimit("DEVICE_CODE", (c) => clientIp(c)));
// #132: token revocation (RFC 7009) for device and CI tokens; always 200, so it reveals nothing.
api.post("/oauth/revoke", async (c) => {
	const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
	const token = typeof form.token === "string" ? form.token : "";
	if (token) {
		const result = await env.DB.prepare(`DELETE FROM "session" WHERE token = ? AND scopes IS NOT NULL`).bind(token).run();
		if (result.meta.changes) logEvent("device.revoked", { via: "oauth/revoke" });
	}
	return c.body(null, 200);
});
api.on(["GET", "POST"], "/auth/*", deviceAuthGate, (c) => auth.handler(c.req.raw));

api.use("*", sessionMiddleware);

api.get("/me", requireRole(), (c) => {
	const { user } = c.get("session")!;
	return c.json({ id: user.id, name: user.name, email: user.email, image: user.image, role: user.role });
});

api.route("/repos", repoRoutes);
api.route("/repos", repoReleaseRoutes);
api.route("/repos", reportRoutes);
api.route("/repos", repoDeployRoutes);
api.route("/repos", repoCowbellRoutes);
api.route("/repos", checkpointRoutes);
api.route("/repos", repoExportRoutes);
api.route("/repos", previewRoutes);
api.route("/repos", repoSessionRoutes);
api.route("/repos", webhookRoutes);
api.route("/repos", repoGraphRoutes);
api.route("/repos", conformanceRoutes);
api.route("/repos", codeRoutes);
api.route("/repos", planeRoutes);
api.route("/repos", a2aRoutes);
api.route("/repos", codeGraphRoutes);
api.route("/repos", memoryRoutes);
api.route("/repos", pullRoutes);
api.route("/repos", checkoutRoutes);
api.route("/owners", payoutRoutes);
api.route("/stripe", stripeWebhookRoutes);
api.route("/me", myPurchaseRoutes);
api.route("/me", myImpactRoutes);
api.route("/me", emailPreferenceRoutes);
api.route("/email", unsubscribeRoutes);
api.route("/sessions", agentSessionRoutes);
api.route("/cowbells", cowbellRoutes);
api.route("/owners", ownerRoutes);
api.route("/me", meRoutes);
api.route("/me/sessions", sessionRoutes);
api.route("/orgs", orgRoutes);
api.route("/legacy", legacyRoutes);
api.route("/deployments", deploymentRoutes);
api.route("/releases", releaseLinkRoutes);
api.route("/downloads", downloadRoutes);
api.route("/deployments", ejectRoutes);
api.route("/eject", ejectDownloadRoutes);
api.route("/cloudflare", cloudflareRoutes);
// R18/R22: /admin is behind Cloudflare Access when deployed; the API checks Access's token too.
// Registered before the admin routes so it runs first.
api.use("/admin/*", requireAccess());
api.route("/admin", adminRepoRoutes);
api.route("/admin", adminReportRoutes);
api.route("/admin", adminCheckpointRoutes);
api.route("/admin", paymentsAdminRoutes);
api.route("/admin", adminGraphRoutes);
api.route("/admin", adminImpactRoutes);
api.route("/me", checkpointExportRoutes);
api.route("/og", ogRoutes);
api.route("/media", mediaRoutes);
api.route("/media", avatarMediaRoutes);


api.onError(onError);

const app = new Hono();
app.onError(onError);
app.route("/api", api);
app.get("/sitemap.xml", sitemap);
app.get("/sitemaps/:name", sitemapPage);

export default {
	fetch: app.fetch,
	// #143: every minute, contributions from new commits and events.
	async scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext): Promise<void> {
		// #131: checkpoints of removed repos are deleted (well within the 24 h promise).
		ctx.waitUntil(new CheckpointStore(env.DB).purgeRemovedRepos(deleteTranscript).then((n) => n && logEvent("checkpoints.purged", { count: n })).catch(() => undefined));
		// #194: and their memory.
		ctx.waitUntil(purgeRemovedRepoMemory().then((n) => n && logEvent("memory.purged", { count: n })).catch(() => undefined));
		// #69: keep open impacts current (new matches, resolved repos).
		// #230: then email owners about repos newly affected.
		ctx.waitUntil(
			syncOpenImpacts()
				.then(() => emailImpacts())
				.catch((error: unknown) => logEvent("impacts.sync_error", { error: error instanceof Error ? error.message : String(error) }, "error")),
		);
		// #67: graph edges of published versions (new publishes and older repos).
		ctx.waitUntil(backfillGraph().catch((error: unknown) => logEvent("graph.backfill_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
		ctx.waitUntil(backfillLanguages().catch((error: unknown) => logEvent("languages.backfill_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
		// #28: branch previews into developers' own Cloudflare accounts.
		ctx.waitUntil(scanPreviews().catch((error: unknown) => logEvent("previews.scan_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
		// #212: register Stripe webhook endpoints once a key is configured.
		ctx.waitUntil(ensureWebhookEndpoints().catch((error: unknown) => logEvent("payments.webhook_setup_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
		// #34: push webhooks to developers' CI.
		ctx.waitUntil(scanWebhooks().catch((error: unknown) => logEvent("webhooks.scan_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
		ctx.waitUntil(scanContributions().catch((error: unknown) => logEvent("contributions.scan_error", { error: error instanceof Error ? error.message : String(error) }, "error")));
	},
} satisfies ExportedHandler;

// D6: the deploy Workflow and its build Sandbox (Durable Object with a container).
export { CiSandbox, DeployWorkflow } from "./deploy/workflow.ts";
// #27: checks on push and on submission.
export { ChecksWorkflow } from "./checks/workflow.ts";
// #182: exact counters for sensitive actions.
export { RateLimiter } from "./rate-limiter-do.ts";
export { RepoPlane } from "./plane/coordinator.ts";
export { MergeWorkflow } from "./plane/merge-workflow.ts";
