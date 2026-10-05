import { PRICE_LIMITS, type Repo, type Sale, platformFeeCents } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { type AuthVariables, requireRole } from "../auth/middleware.ts";
import { decryptToken, encryptToken } from "../cloudflare/crypto.ts";
import { logEvent } from "../observability/log.ts";
import { OwnerStore } from "../owners/store.ts";
import { canEdit } from "../repos/access.ts";
import { RepoStore } from "../repos/repository.ts";
import { payments, type StripeAccountObject, toPayoutAccount } from "./store.ts";
import { StripeError, stripe, stripeConfigured, verifyStripeSignature } from "./stripe.ts";

type Ctx = { Variables: AuthVariables };

const WEBHOOK_SECRETS = ["stripe_webhook_secret", "stripe_connect_webhook_secret"] as const;
const PLATFORM_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"];
const CONNECT_EVENTS = ["account.updated"];

function key(c: Context<Ctx>): string | Response {
	return stripeConfigured(env.STRIPE_SECRET_KEY) ? env.STRIPE_SECRET_KEY : c.json({ error: "payments_off", message: "Payments are not set up on this server yet." }, 503);
}

function stripeFailure(c: Context<Ctx>, error: unknown): Response {
	if (!(error instanceof StripeError)) throw error;
	logEvent("payments.stripe_failed", { status: error.status, code: error.code, message: error.message.slice(0, 200) }, "warn");
	return c.json({ error: "stripe_error", message: `Stripe said: ${error.message}` }, 502);
}

/** The owner (user or org) whose payouts the signed-in user may manage: themselves, or an org they own. */
async function payoutOwner(c: Context<Ctx>) {
	const store = new OwnerStore(env.DB);
	const owner = await store.byHandle(c.req.param("handle")!.toLowerCase());
	const user = c.get("session")!.user;
	if (!owner) return null;
	if (owner.kind === "user") return owner.id === (await store.forUser(user)).id ? owner : null;
	return (await store.roleIn(owner.id, user.id)) === "owner" ? owner : null;
}

/** Stripe's account object, saved; also how status catches up when a webhook is late. */
async function refreshAccount(sk: string, ownerId: string, accountId: string) {
	const account = await stripe<StripeAccountObject>(sk, "GET", `/accounts/${accountId}`);
	await payments.saveAccount(ownerId, account);
	return toPayoutAccount(await payments.account(ownerId));
}

/** #211: payouts with Stripe Connect Express. Mounted under /api/owners. */
export const payoutRoutes = new Hono<Ctx>()
	.use("/:handle/payouts/*", requireRole())
	.use("/:handle/payouts", requireRole())
	.get("/:handle/payouts", async (c) => {
		const owner = await payoutOwner(c);
		if (!owner) return c.json({ error: "not_found" }, 404);
		const row = await payments.account(owner.id);
		const sk = env.STRIPE_SECRET_KEY;
		if (!row || row.transfers_active || !stripeConfigured(sk)) return c.json({ ...toPayoutAccount(row), enabled: stripeConfigured(sk) });
		try {
			return c.json({ ...(await refreshAccount(sk, owner.id, row.account_id)), enabled: true });
		} catch (error) {
			return stripeFailure(c, error);
		}
	})
	.post("/:handle/payouts/onboard", async (c) => {
		const sk = key(c);
		if (sk instanceof Response) return sk;
		const owner = await payoutOwner(c);
		if (!owner) return c.json({ error: "not_found" }, 404);
		const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { country?: unknown; returnTo?: unknown };
		const country = typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : "US";
		try {
			let row = await payments.account(owner.id);
			if (!row) {
				const account = await stripe<StripeAccountObject>(
					sk,
					"POST",
					"/accounts",
					{
						type: "express",
						country,
						email: owner.kind === "user" ? c.get("session")!.user.email : undefined,
						capabilities: { transfers: { requested: true } },
						// Outside the platform's country, Express accounts receive transfers under the recipient agreement.
						tos_acceptance: country === "US" ? undefined : { service_agreement: "recipient" },
						// Stripe refuses localhost URLs; the profile URL is only sent from a public origin.
						business_profile: { url: env.PUBLIC_ORIGIN.startsWith("https://") ? `${env.PUBLIC_ORIGIN}/${owner.handle}` : undefined, product_description: "Apps sold on appmarket.org" },
						metadata: { appmarket_owner: owner.id, appmarket_handle: owner.handle },
					},
					{ idempotencyKey: `account:${owner.id}` },
				);
				await payments.saveAccount(owner.id, account);
				row = await payments.account(owner.id);
				logEvent("payments.account_created", { owner: owner.handle, country });
			}
			// Back to the page that started it (a dashboard path on this site only).
			const returnTo = typeof body.returnTo === "string" && /^\/dashboard\/[A-Za-z0-9/_.-]+$/.test(body.returnTo) ? body.returnTo : "/settings";
			const back = `${env.PUBLIC_ORIGIN}${returnTo}?payouts=1`;
			const link = await stripe<{ url: string }>(sk, "POST", "/account_links", { account: row!.account_id, type: "account_onboarding", refresh_url: back, return_url: back });
			return c.json({ url: link.url });
		} catch (error) {
			return stripeFailure(c, error);
		}
	})
	.post("/:handle/payouts/dashboard", async (c) => {
		const sk = key(c);
		if (sk instanceof Response) return sk;
		const owner = await payoutOwner(c);
		const row = owner && (await payments.account(owner.id));
		if (!row) return c.json({ error: "not_found" }, 404);
		try {
			return c.json({ url: (await stripe<{ url: string }>(sk, "POST", `/accounts/${row.account_id}/login_links`, {})).url });
		} catch (error) {
			return stripeFailure(c, error);
		}
	});

const toSale = (r: Awaited<ReturnType<typeof payments.sales>>[number]): Sale => ({
	id: r.id,
	repo: r.full_name,
	buyer: r.buyer,
	amountCents: r.amount_cents,
	feeCents: r.fee_cents,
	currency: r.currency,
	status: r.status as Sale["status"],
	createdAt: r.created_at,
});

/** Whether the user may use a paid app: editors and buyers whose purchase stands. */
export async function entitled(repo: Repo, session: AuthVariables["session"]): Promise<boolean> {
	if (repo.priceCents <= 0) return true;
	if (!session) return false;
	return canEdit(repo, session) || (await payments.owns(session.user.id, repo.id));
}

/** #212/#213: price, checkout and ownership. Mounted under /api/repos. */
export const checkoutRoutes = new Hono<Ctx>()
	.put("/:owner/:slug/price", requireRole(), async (c) => {
		const store = new RepoStore(env.DB);
		const repo = await store.findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const body = (await c.req.json().catch(() => null)) as { priceCents?: unknown } | null;
		const price = body?.priceCents;
		if (typeof price !== "number" || !Number.isInteger(price) || (price !== 0 && (price < PRICE_LIMITS.minCents || price > PRICE_LIMITS.maxCents))) {
			return c.json({ error: "invalid", message: `Free, or between $${PRICE_LIMITS.minCents / 100} and $${PRICE_LIMITS.maxCents / 100}.` }, 400);
		}
		if (price > 0) {
			if (!stripeConfigured(env.STRIPE_SECRET_KEY)) return c.json({ error: "payments_off", message: "Payments are not set up on this server yet." }, 503);
			const account = await payments.account(repo.owner.id);
			if (!account?.transfers_active) return c.json({ error: "payouts_not_ready", message: `Set up payouts for ${repo.owner.handle} first.` }, 409);
		}
		await env.DB.prepare("UPDATE repos SET price_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(price, repo.id).run();
		logEvent("payments.price_set", { repo: repo.fullName, priceCents: price });
		return c.json(await store.findById(repo.id));
	})
	// #214: the repo's sales for owners and org members.
	.get("/:owner/:slug/sales", requireRole(), async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo || !canEdit(repo, c.get("session"))) return c.json({ error: "not_found" }, 404);
		const items = (await payments.sales(repo.id)).map(toSale);
		const paid = items.filter((s) => s.status === "paid");
		return c.json({ items, totals: { sales: paid.length, grossCents: paid.reduce((n, s) => n + s.amountCents, 0), netCents: paid.reduce((n, s) => n + s.amountCents - s.feeCents, 0) } });
	})
	.get("/:owner/:slug/ownership", async (c) => {
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		if (!repo) return c.json({ error: "not_found" }, 404);
		c.header("Cache-Control", "private, no-store");
		return c.json({ priceCents: repo.priceCents, owned: await entitled(repo, c.get("session")), signedIn: !!c.get("session") });
	})
	.post("/:owner/:slug/checkout", requireRole(), async (c) => {
		const sk = key(c);
		if (sk instanceof Response) return sk;
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		const session = c.get("session")!;
		if (!repo || repo.state !== "published" || repo.priceCents <= 0) return c.json({ error: "not_found" }, 404);
		if (await entitled(repo, session)) return c.json({ error: "owned", message: "You already have this app." }, 409);
		const seller = await payments.account(repo.owner.id);
		if (!seller?.transfers_active) return c.json({ error: "not_for_sale", message: "This app cannot be bought right now." }, 409);
		const base = `${env.PUBLIC_ORIGIN}/${repo.fullName}`;
		try {
			const checkout = await stripe<{ id: string; url: string }>(sk, "POST", "/checkout/sessions", {
				mode: "payment",
				line_items: [{ quantity: 1, price_data: { currency: PRICE_LIMITS.currency, unit_amount: repo.priceCents, product_data: { name: repo.name, description: repo.summary } } }],
				payment_intent_data: {
					application_fee_amount: platformFeeCents(repo.priceCents),
					transfer_data: { destination: seller.account_id },
					metadata: { repo_id: repo.id, user_id: session.user.id },
					description: `${repo.fullName} on appmarket.org`,
				},
				metadata: { repo_id: repo.id, user_id: session.user.id },
				client_reference_id: session.user.id,
				customer_email: session.user.email,
				success_url: `${base}?purchase={CHECKOUT_SESSION_ID}`,
				cancel_url: base,
			});
			logEvent("payments.checkout_started", { repo: repo.fullName, session: checkout.id });
			return c.json({ url: checkout.url });
		} catch (error) {
			return stripeFailure(c, error);
		}
	})
	// The success page confirms right away, so ownership does not wait for the webhook.
	.post("/:owner/:slug/checkout/confirm", requireRole(), async (c) => {
		const sk = key(c);
		if (sk instanceof Response) return sk;
		const repo = await new RepoStore(env.DB).findByPath(c.req.param("owner"), c.req.param("slug"));
		const body = (await c.req.json().catch(() => null)) as { sessionId?: unknown } | null;
		if (!repo || typeof body?.sessionId !== "string" || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(body.sessionId)) return c.json({ error: "invalid" }, 400);
		try {
			const s = await stripe<CheckoutSession>(sk, "GET", `/checkout/sessions/${body.sessionId}`);
			if (s.metadata?.repo_id !== repo.id || s.metadata?.user_id !== c.get("session")!.user.id) return c.json({ error: "invalid" }, 400);
			if (s.payment_status === "paid") await recordFromSession(s);
			return c.json({ owned: await payments.owns(c.get("session")!.user.id, repo.id) });
		} catch (error) {
			return stripeFailure(c, error);
		}
	});

interface CheckoutSession {
	id: string;
	payment_status: string;
	amount_total: number;
	currency: string;
	payment_intent: string | null;
	metadata?: { repo_id?: string; user_id?: string };
}

async function recordFromSession(s: CheckoutSession): Promise<void> {
	if (!s.metadata?.repo_id || !s.metadata.user_id) return;
	await payments.recordPurchase({ repoId: s.metadata.repo_id, userId: s.metadata.user_id, amountCents: s.amount_total, feeCents: platformFeeCents(s.amount_total), currency: s.currency, sessionId: s.id, paymentIntentId: s.payment_intent });
	logEvent("payments.purchased", { repo: s.metadata.repo_id, session: s.id });
}

/** #212: Stripe webhooks (platform and Connect endpoints). Mounted under /api/stripe. */
export const stripeWebhookRoutes = new Hono<Ctx>().post("/webhook", async (c) => {
	const payload = await c.req.text();
	const signature = c.req.header("stripe-signature");
	let valid = false;
	for (const name of WEBHOOK_SECRETS) {
		const sealed = await payments.secret(name);
		if (sealed && (await verifyStripeSignature(payload, signature, await decryptToken(env.CF_TOKEN_ENCRYPTION_KEY, sealed, name)))) valid = true;
	}
	if (!valid) return c.json({ error: "invalid_signature" }, 400);
	const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
	const o = event.data.object;
	switch (event.type) {
		case "checkout.session.completed":
		case "checkout.session.async_payment_succeeded":
			if (o.payment_status === "paid") await recordFromSession(o as unknown as CheckoutSession);
			break;
		case "charge.refunded":
			// Only a full refund removes the app.
			if (o.refunded === true && typeof o.payment_intent === "string") await payments.setStatusByPayment(o.payment_intent, "refunded");
			break;
		case "charge.dispute.created":
			if (typeof o.payment_intent === "string") await payments.setStatusByPayment(o.payment_intent, "disputed");
			break;
		case "charge.dispute.closed":
			if (o.status === "won" && typeof o.payment_intent === "string") await payments.setStatusByPayment(o.payment_intent, "paid");
			break;
		case "account.updated":
			await payments.updateByAccountId(o as unknown as StripeAccountObject);
			break;
	}
	logEvent("payments.webhook", { type: event.type });
	return c.json({ received: true });
});

/**
 * #212: creates appmarket's two Stripe webhook endpoints (platform and Connect) at
 * PUBLIC_ORIGIN/api/stripe/webhook, replacing ones with that URL, and stores their signing
 * secrets encrypted. Needs a public https origin.
 */
async function createWebhookEndpoints(sk: string): Promise<{ url: string; endpoints: string[] }> {
	const url = `${env.PUBLIC_ORIGIN}/api/stripe/webhook`;
	const existing = await stripe<{ data: { id: string; url: string }[] }>(sk, "GET", "/webhook_endpoints", { limit: 100 });
	for (const e of existing.data.filter((e) => e.url === url)) await stripe(sk, "DELETE", `/webhook_endpoints/${e.id}`);
	const made: string[] = [];
	for (const [name, events, connect] of [[WEBHOOK_SECRETS[0], PLATFORM_EVENTS, false], [WEBHOOK_SECRETS[1], CONNECT_EVENTS, true]] as const) {
		const endpoint = await stripe<{ id: string; secret: string }>(sk, "POST", "/webhook_endpoints", { url, enabled_events: [...events], connect, description: `appmarket.org ${connect ? "Connect" : "platform"} events` });
		await payments.setSecret(name, await encryptToken(env.CF_TOKEN_ENCRYPTION_KEY, endpoint.secret, name));
		made.push(endpoint.id);
	}
	logEvent("payments.webhooks_configured", { endpoints: made.length });
	return { url, endpoints: made };
}

/** Cron: once a key is configured on a public origin, register the endpoints if none are stored. */
export async function ensureWebhookEndpoints(): Promise<void> {
	const sk = env.STRIPE_SECRET_KEY;
	if (!stripeConfigured(sk) || !env.PUBLIC_ORIGIN.startsWith("https://")) return;
	if ((await Promise.all(WEBHOOK_SECRETS.map((n) => payments.secret(n)))).every(Boolean)) return;
	await createWebhookEndpoints(sk);
}

/** #212: re-creates the webhook endpoints (e.g. after rotating them in Stripe); #214: sales and refunds. Mounted under /api/admin. */
export const paymentsAdminRoutes = new Hono<Ctx>()
	.use(requireRole("admin"))
	.get("/purchases", async (c) => c.json({ items: (await payments.sales(null, 200)).map(toSale) }))
	// Full refund: the developer's transfer and appmarket's fee are reversed; ownership ends now
	// (the charge.refunded webhook would do the same).
	.post("/purchases/:id/refund", async (c) => {
		const sk = key(c);
		if (sk instanceof Response) return sk;
		const purchase = await payments.purchase(c.req.param("id"));
		if (!purchase?.payment_intent_id) return c.json({ error: "not_found" }, 404);
		if (purchase.status !== "paid") return c.json({ error: "not_refundable", message: `This purchase is ${purchase.status}.` }, 409);
		try {
			await stripe(sk, "POST", "/refunds", { payment_intent: purchase.payment_intent_id, reverse_transfer: true, refund_application_fee: true, metadata: { refunded_by: c.get("session")!.user.id } }, { idempotencyKey: `refund:${purchase.id}` });
		} catch (error) {
			return stripeFailure(c, error);
		}
		await payments.setStatusByPayment(purchase.payment_intent_id, "refunded");
		logEvent("payments.refunded", { purchase: purchase.id, admin: c.get("session")!.user.id });
		return c.json({ ok: true });
	})
	.post("/payments/webhook-endpoints", async (c) => {
	const sk = key(c);
	if (sk instanceof Response) return sk;
	if (!env.PUBLIC_ORIGIN.startsWith("https://")) return c.json({ error: "invalid", message: "Stripe needs a public https URL; set up webhooks on staging or production." }, 400);
	try {
		return c.json(await createWebhookEndpoints(sk));
	} catch (error) {
		return stripeFailure(c, error);
	}
});

/** #213: the signed-in buyer's purchases. Mounted under /api/me. */
export const myPurchaseRoutes = new Hono<Ctx>().get("/purchases", requireRole(), async (c) => {
	const rows = await payments.purchasesOf(c.get("session")!.user.id);
	return c.json({ items: rows.map((r) => ({ repo: r.full_name, name: r.name, amountCents: r.amount_cents, currency: r.currency, status: r.status, purchasedAt: r.created_at })) });
});
