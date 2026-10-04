import { PRICE_TABLE_VERSION } from "@appmarket/shared";
import { describe, expect, it } from "vitest";
import { record } from "./fixtures.ts";
import { priceRecord } from "./pricing.ts";

describe("priceRecord", () => {
	it("fills cost for known models, keeps reported cost, leaves unknown models empty", () => {
		const priced = priceRecord({ ...record(1), usage: { input_tokens: 1_000_000, output_tokens: 0, cost_usd: null } });
		expect(priced.usage).toMatchObject({ cost_usd: 4, cost_priced: PRICE_TABLE_VERSION });
		const reported = { ...record(1), usage: { input_tokens: 1_000_000, output_tokens: 0, cost_usd: 1.23 } };
		expect(priceRecord(reported)).toBe(reported);
		expect(priceRecord({ ...record(1), model: "mystery-1" }).usage.cost_usd).toBeNull();
	});
});
