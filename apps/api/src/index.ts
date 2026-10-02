import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { auth } from "./auth/auth.ts";
import { type AuthVariables, requireRole, sessionMiddleware } from "./auth/middleware.ts";
import { adminListingRoutes, listingRoutes } from "./listings/routes.ts";
import { sitemap } from "./routes/seo.ts";

// appmarket.org API. The Angular web Worker forwards /api/* and /sitemap.xml here via a service binding.
const api = new Hono<{ Variables: AuthVariables }>();

api.get("/health", (c) => c.json({ ok: true, env: env.APP_ENV }));

// R11: Better Auth handles sign-in, OAuth callbacks, sessions and sign-out under /api/auth/*.
api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

api.use("*", sessionMiddleware);

api.get("/me", requireRole(), (c) => {
	const { user } = c.get("session")!;
	return c.json({ id: user.id, name: user.name, email: user.email, image: user.image, role: user.role });
});

api.route("/listings", listingRoutes);
api.route("/admin", adminListingRoutes);

// Phase 1: /releases (R13), /downloads (R14). /admin also goes behind Cloudflare Access at deploy (R18, R22).

const app = new Hono();
app.route("/api", api);
app.get("/sitemap.xml", sitemap);

export default app;
