import type { PayoutAccount } from "@appmarket/shared";
import { env } from "cloudflare:workers";

interface AccountRow {
	owner_id: string;
	account_id: string;
	country: string | null;
	details_submitted: number;
	payouts_enabled: number;
	transfers_active: number;
}

export interface StripeAccountObject {
	id: string;
	country?: string;
	details_submitted?: boolean;
	payouts_enabled?: boolean;
	capabilities?: { transfers?: string };
}

export const toPayoutAccount = (row: AccountRow | null): PayoutAccount =>
	row
		? { connected: true, ready: !!row.transfers_active, detailsSubmitted: !!row.details_submitted, payoutsEnabled: !!row.payouts_enabled, country: row.country }
		: { connected: false, ready: false, detailsSubmitted: false, payoutsEnabled: false, country: null };

/** #42: Stripe accounts, purchases (entitlements) and platform secrets in D1. */
export const payments = {
	account: (ownerId: string) => env.DB.prepare("SELECT * FROM stripe_accounts WHERE owner_id = ?").bind(ownerId).first<AccountRow>(),

	saveAccount: (ownerId: string, a: StripeAccountObject) =>
		env.DB.prepare(
			`INSERT INTO stripe_accounts (owner_id, account_id, country, details_submitted, payouts_enabled, transfers_active) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (owner_id) DO UPDATE SET country = excluded.country, details_submitted = excluded.details_submitted, payouts_enabled = excluded.payouts_enabled,
			   transfers_active = excluded.transfers_active, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
			.bind(ownerId, a.id, a.country ?? null, a.details_submitted ? 1 : 0, a.payouts_enabled ? 1 : 0, a.capabilities?.transfers === "active" ? 1 : 0)
			.run(),

	/** From the account.updated webhook: the account id is all we get. */
	updateByAccountId: (a: StripeAccountObject) =>
		env.DB.prepare(
			"UPDATE stripe_accounts SET details_submitted = ?, payouts_enabled = ?, transfers_active = ?, country = COALESCE(?, country), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE account_id = ?",
		)
			.bind(a.details_submitted ? 1 : 0, a.payouts_enabled ? 1 : 0, a.capabilities?.transfers === "active" ? 1 : 0, a.country ?? null, a.id)
			.run(),

	/** Whether the user owns the app: a paid purchase (refunds and disputes revoke it). */
	owns: async (userId: string, repoId: string) => !!(await env.DB.prepare("SELECT 1 FROM purchases WHERE user_id = ? AND repo_id = ? AND status = 'paid' LIMIT 1").bind(userId, repoId).first()),

	/** Idempotent: one purchase per Checkout Session. */
	recordPurchase: (p: { repoId: string; userId: string; amountCents: number; feeCents: number; currency: string; sessionId: string; paymentIntentId: string | null }) =>
		env.DB.prepare(
			"INSERT INTO purchases (id, repo_id, user_id, amount_cents, fee_cents, currency, checkout_session_id, payment_intent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (checkout_session_id) DO NOTHING",
		)
			.bind(crypto.randomUUID(), p.repoId, p.userId, p.amountCents, p.feeCents, p.currency, p.sessionId, p.paymentIntentId)
			.run(),

	setStatusByPayment: (paymentIntentId: string, status: "refunded" | "disputed" | "paid") =>
		env.DB.prepare("UPDATE purchases SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE payment_intent_id = ?").bind(status, paymentIntentId).run(),

	purchasesOf: async (userId: string) =>
		(
			await env.DB.prepare(
				`SELECT p.repo_id, p.amount_cents, p.currency, p.status, p.created_at, o.handle || '/' || r.slug AS full_name, r.name
				 FROM purchases p JOIN repos r ON r.id = p.repo_id JOIN owners o ON o.id = r.owner_id WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 200`,
			)
				.bind(userId)
				.all<{ repo_id: string; amount_cents: number; currency: string; status: string; created_at: string; full_name: string; name: string }>()
		).results,

	secret: async (name: string) => (await env.DB.prepare("SELECT value_enc FROM app_secrets WHERE name = ?").bind(name).first<{ value_enc: string }>())?.value_enc ?? null,
	setSecret: (name: string, valueEnc: string) =>
		env.DB.prepare("INSERT INTO app_secrets (name, value_enc) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(name, valueEnc).run(),
};
