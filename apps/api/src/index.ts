import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { createRepo } from "./routes/repos.ts";
import { sitemap } from "./routes/seo.ts";
import { createToken } from "./routes/tokens.ts";

// appmarket.org API. The Angular web Worker forwards /api/* and /sitemap.xml here via a service binding.
const api = new Hono();

api.get("/health", (c) => c.json({ ok: true, env: env.APP_ENV }));

// Phase 0 routes. Unauthenticated: localhost only, never deploy as-is (replaced by R3 + R11).
api.post("/repos", (c) => createRepo(c.req.raw));
api.post("/repos/:name{[A-Za-z0-9][A-Za-z0-9._-]*}/tokens", (c) => createToken(c.req.raw, c.req.param("name")));

// Phase 1: /auth/* (R11, Better Auth with Google + GitHub), /listings (R1, R12), /releases (R13),
// /downloads (R14), /admin (R18, behind Cloudflare Access).

const app = new Hono();
app.route("/api", api);
app.get("/sitemap.xml", sitemap);

export default app;
