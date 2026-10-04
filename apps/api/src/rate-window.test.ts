import { describe, expect, it } from "vitest";
import { hit, type Window } from "./rate-window.ts";

describe("fixed window (#182)", () => {
	it("allows exactly the limit per window, then tells how long to wait", () => {
		let w: Window | undefined;
		const results: boolean[] = [];
		for (let i = 0; i < 12; i++) {
			const r = hit(w, 1_000 + i, 10, 60_000);
			w = r.window;
			results.push(r.success);
		}
		expect(results.filter(Boolean)).toHaveLength(10);
		expect(results.slice(10)).toEqual([false, false]);
		expect(hit(w, 31_000, 10, 60_000)).toMatchObject({ success: false, retryAfter: 30 });
		expect(hit(w, 61_000, 10, 60_000)).toMatchObject({ success: true, window: { start: 61_000, count: 1 } });
	});
});
