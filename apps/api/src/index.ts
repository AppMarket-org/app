import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { requireAccess } from "./auth/access.ts";
import { auth } from "./auth/auth.ts";
import { type AuthVariables, deviceAuthGate, requireRole, sessionMiddleware } from "./auth/middleware.ts";
import { adminRepoRoutes, repoRoutes, mediaRoutes } from "./repos/routes.ts";
import { checkpointRoutes } from "./checkpoints/routes.ts";
import { cloudflareRoutes } from "./cloudflare/routes.ts";
import { cowbellRoutes, repoCowbellRoutes } from "./cowbells/routes.ts";
import { deploymentRoutes, repoDeployRoutes } from "./deploy/routes.ts";
import { adminReportRoutes, reportRoutes } from "./moderation/routes.ts";
import { downloadRoutes, repoReleaseRoutes, releaseLinkRoutes } from "./releases/routes.ts";
import { clientIp, rateLimit } from "./rate-limit.ts";
import { sitemap, sitemapPage } from "./routes/seo.ts";
import { onError } from "./observability/errors.ts";
import { legacyRoutes, meRoutes, orgRoutes, ownerRoutes, sessionRoutes } from "./owners/routes.ts";

// appmarket.org API. The Angular web Worker forwards /api/* and /sitemap.xml here via a service binding.
const api = new Hono<{ Variables: AuthVariables }>();

api.get("/health", (c) => c.json({ ok: true, env: env.APP_ENV }));

// R11: Better Auth handles sign-in, OAuth callbacks, sessions and sign-out under /api/auth/*.
api.post("/auth/sign-in/*", rateLimit(() => env.RL_SIGN_IN, (c) => `sign-in:${clientIp(c)}`, env.RATE_LIMIT_CONFIG.SIGN_IN.period));
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
api.route("/cowbells", cowbellRoutes);
api.route("/owners", ownerRoutes);
api.route("/me", meRoutes);
api.route("/me/sessions", sessionRoutes);
api.route("/orgs", orgRoutes);
api.route("/legacy", legacyRoutes);
api.route("/deployments", deploymentRoutes);
api.route("/releases", releaseLinkRoutes);
api.route("/downloads", downloadRoutes);
api.route("/cloudflare", cloudflareRoutes);
// R18/R22: /admin is behind Cloudflare Access when deployed; the API checks Access's token too.
// Registered before the admin routes so it runs first.
api.use("/admin/*", requireAccess());
api.route("/admin", adminRepoRoutes);
api.route("/admin", adminReportRoutes);
api.route("/media", mediaRoutes);


api.onError(onError);

const app = new Hono();
app.onError(onError);
app.route("/api", api);
app.get("/sitemap.xml", sitemap);
app.get("/sitemaps/:name", sitemapPage);

export default app;

// D6: the deploy Workflow and its build Sandbox (Durable Object with a container).
export { CiSandbox, DeployWorkflow } from "./deploy/workflow.ts";
