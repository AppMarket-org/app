import { describe, expect, it } from "vitest";
import { costUsd, priceFor } from "./prices";

describe("price table", () => {
	it("matches exact and dated model IDs, and nothing else", () => {
		expect(priceFor("claude-haiku-4-5-20251001")).toEqual(priceFor("claude-haiku-4-5"));
		expect(priceFor("gpt-6.1-sol")?.output).toBe(10);
		expect(priceFor("some-new-model")).toBeNull();
	});

	it("prices fresh input, cache reads, cache writes and output", () => {
		// Opus 5.5: 1M fresh × $4 + 2M read × $0.20 + 1M write × $5 + 0.1M out × $20 = 4 + 0.4 + 5 + 2
		expect(costUsd("claude-opus-5-5", { input_tokens: 4_000_000, cache_read_tokens: 2_000_000, cache_write_tokens: 1_000_000, output_tokens: 100_000 })).toBe(11.4);
		// OpenAI has no write price: writes are billed as input.
		expect(costUsd("gpt-6.1-sol", { input_tokens: 36_581, cache_read_tokens: 31_232, output_tokens: 281 })).toBe(0.0166);
		expect(costUsd("unknown", { input_tokens: 1, output_tokens: 1 })).toBeNull();
		expect(costUsd("claude-opus-5-5", { input_tokens: null, output_tokens: 1 })).toBeNull();
	});
});
