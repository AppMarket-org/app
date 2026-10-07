import { Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { authorizationUrl, cloudflareAccounts, cloudflareConfigured, completeAuthorization, connection, disconnect } from "./oauth.ts";

type Ctx = { Variables: AuthVariables };

/** Only same-site paths are allowed as the place to return to after connecting. */
const safeReturn = (value: string | undefined) => (value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard/cloudflare");

/** PRD D5: connect, inspect and disconnect the buyer's Cloudflare account. Mounted under /api/cloudflare. */
export const cloudflareRoutes = new Hono<Ctx>()
	.use(requireRole())
	.get("/connection", async (c) => c.json(await connection(c.get("session")!.user.id)))
	.get("/connect", async (c) => {
		// Without appmarket.org's OAuth client, Cloudflare would only show an error page.
		if (!cloudflareConfigured()) return c.redirect("/dashboard/cloudflare?error=unavailable", 302);
		return c.redirect(await authorizationUrl(c.get("session")!.user.id, safeReturn(c.req.query("return"))), 302);
	})
	.get("/callback", async (c) => {
		const { code, state, error } = c.req.query();
		if (error || !code || !state) return c.redirect(`/dashboard/cloudflare?error=${encodeURIComponent(error ?? "missing_code")}`, 302);
		const result = await completeAuthorization(c.get("session")!.user.id, state, code);
		if (!result.ok) return c.redirect(`/dashboard/cloudflare?error=${result.reason}`, 302);
		const back = new URL(result.returnTo, "https://x");
		back.searchParams.set("connected", "1");
		return c.redirect(back.pathname + back.search, 302);
	})
	.post("/disconnect", async (c) => {
		await disconnect(c.get("session")!.user.id);
		return c.json({ connected: false });
	})
	.get("/accounts", async (c) => {
		if (!cloudflareConfigured()) return c.json({ error: "unavailable", message: "Deploying to Cloudflare is not available on appmarket.org yet." }, 409);
		const accounts = await cloudflareAccounts(c.get("session")!.user.id);
		if (!Array.isArray(accounts)) return c.json({ error: accounts }, 409);
		return c.json({ items: accounts });
	});
