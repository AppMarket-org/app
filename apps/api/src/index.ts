import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { auth } from "./auth/auth.ts";
import { type AuthVariables, requireRole, sessionMiddleware } from "./auth/middleware.ts";
import { listingRoutes } from "./listings/routes.ts";
import { createRepo } from "./routes/repos.ts";
import { sitemap } from "./routes/seo.ts";
import { createToken } from "./routes/tokens.ts";

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

// Phase 0 routes. Unauthenticated: localhost only, never deploy as-is (replaced by R3).
api.post("/repos", (c) => createRepo(c.req.raw));
api.post("/repos/:name{[A-Za-z0-9][A-Za-z0-9._-]*}/tokens", (c) => createToken(c.req.raw, c.req.param("name")));

api.route("/listings", listingRoutes);

// Phase 1: lifecycle (R12), /releases (R13), /downloads (R14), /admin (R18, behind Cloudflare Access).

const app = new Hono();
app.route("/api", api);
app.get("/sitemap.xml", sitemap);

export default app;
