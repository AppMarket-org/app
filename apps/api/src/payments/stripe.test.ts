import { platformFeeCents } from "@appmarket/shared";
import { describe, expect, it, vi } from "vitest";
import { encode, signForTest, StripeError, stripe, stripeConfigured, verifyStripeSignature } from "./stripe";

describe("Stripe client (#42)", () => {
	it("form-encodes nested params like Stripe's SDKs", () => {
		const body = encode({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 500 } }], payment_intent_data: { application_fee_amount: 50, transfer_data: { destination: "acct_1" } }, skip: undefined });
		expect(decodeURIComponent(body.toString())).toBe(
			"mode=payment&line_items[0][quantity]=1&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=500&payment_intent_data[application_fee_amount]=50&payment_intent_data[transfer_data][destination]=acct_1",
		);
	});

	it("sends auth, version and idempotency headers and surfaces Stripe errors", async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: "resource_missing", message: "No such account" } }), { status: 404 }));
		await expect(stripe("sk_test_x", "POST", "/accounts/acct_1", { a: 1 }, { idempotencyKey: "k1", fetcher: fetcher as unknown as typeof fetch })).rejects.toEqual(new StripeError(404, "resource_missing", "No such account"));
		const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.headers).toMatchObject({ Authorization: "Bearer sk_test_x", "Idempotency-Key": "k1" });
	});

	it("verifies webhook signatures within five minutes only", async () => {
		const payload = JSON.stringify({ id: "evt_1" });
		const header = await signForTest(payload, "whsec_abc");
		expect(await verifyStripeSignature(payload, header, "whsec_abc")).toBe(true);
		expect(await verifyStripeSignature(`${payload} `, header, "whsec_abc")).toBe(false);
		expect(await verifyStripeSignature(payload, header, "whsec_other")).toBe(false);
		expect(await verifyStripeSignature(payload, await signForTest(payload, "whsec_abc", Math.floor(Date.now() / 1000) - 600), "whsec_abc")).toBe(false);
		expect(await verifyStripeSignature(payload, undefined, "whsec_abc")).toBe(false);
	});

	it("takes 10% and knows a placeholder from a key", () => {
		expect(platformFeeCents(999)).toBe(100);
		expect(platformFeeCents(500)).toBe(50);
		expect(stripeConfigured("not-configured")).toBe(false);
		expect(stripeConfigured("sk_test_abc123")).toBe(true);
	});
});
