/**
 * #127: model prices for checkpoint cost when the harness does not report one. USD per million
 * tokens, standard (non-batch) rates, from the providers' own pricing pages:
 * claude.com/pricing and developers.openai.com/api/docs/pricing, read on PRICE_TABLE_VERSION.
 * Reasoning/thinking tokens are billed as output by both, so they are not priced separately.
 * Update the version with any change; records keep the version they were priced with.
 */
export const PRICE_TABLE_VERSION = "2026-10-04";

export interface ModelPrice {
	input: number;
	cachedInput: number;
	/** Anthropic prompt-cache writes; providers without a write price bill them as input. */
	cacheWrite?: number;
	output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
	// Anthropic
	"claude-fable-5-1": { input: 10, cachedInput: 0.25, cacheWrite: 12.5, output: 50 },
	"claude-opus-5-5": { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
	"claude-sonnet-5-5": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
	"claude-haiku-4-5": { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
	// OpenAI
	"gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
	"gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
	"gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
	"gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
};

/** Exact ID, or the ID with a date suffix (claude-haiku-4-5-20251001). */
export function priceFor(model: string): ModelPrice | null {
	if (MODEL_PRICES[model]) return MODEL_PRICES[model]!;
	const base = model.replace(/-\d{8}$/, "");
	return MODEL_PRICES[base] ?? null;
}

export interface UsageForCost {
	/** All input, including cache reads and writes. */
	input_tokens: number | null;
	output_tokens: number | null;
	cache_read_tokens?: number | null;
	cache_write_tokens?: number | null;
}

/** Cost in USD (rounded to 0.0001), or null for an unknown model or missing usage. */
export function costUsd(model: string, usage: UsageForCost): number | null {
	const price = priceFor(model);
	if (!price || usage.input_tokens === null || usage.output_tokens === null) return null;
	const read = usage.cache_read_tokens ?? 0;
	const write = usage.cache_write_tokens ?? 0;
	const fresh = Math.max(0, usage.input_tokens - read - write);
	const dollars = (fresh * price.input + read * price.cachedInput + write * (price.cacheWrite ?? price.input) + usage.output_tokens * price.output) / 1_000_000;
	return Math.round(dollars * 10_000) / 10_000;
}

/** #42 (R17): appmarket.org's share of each sale (owner decision, 2026-10-04). */
export const PLATFORM_FEE_RATE = 0.1;
/** Prices are whole US cents; one-time purchases between $1 and $1,000 to start. */
export const PRICE_LIMITS = { minCents: 100, maxCents: 100_000, currency: "usd" } as const;
export const platformFeeCents = (priceCents: number) => Math.round(priceCents * PLATFORM_FEE_RATE);

/** #211: a developer's (or org's) Stripe payouts account as appmarket shows it. */
export interface PayoutAccount {
	connected: boolean;
	/** Can receive transfers from sales; prices can be set only then. */
	ready: boolean;
	detailsSubmitted: boolean;
	payoutsEnabled: boolean;
	country: string | null;
}
