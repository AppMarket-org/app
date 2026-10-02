import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit.ts";

function fakeLimiter(allowed: number): RateLimit {
	const counts = new Map<string, number>();
	return {
		limit: async ({ key }: { key: string }) => {
			const n = (counts.get(key) ?? 0) + 1;
			counts.set(key, n);
			return { success: n <= allowed };
		},
	} as RateLimit;
}

describe("rateLimit", () => {
	it("allows up to the limit per key, then 429 with Retry-After", async () => {
		const limiter = fakeLimiter(2);
		const app = new Hono().post("/", rateLimit(() => limiter, (c) => c.req.header("x-user") ?? "", 60), (c) => c.text("ok"));
		const call = (user: string) => app.request("/", { method: "POST", headers: { "x-user": user } });
		expect((await call("a")).status).toBe(200);
		expect((await call("a")).status).toBe(200);
		const limited = await call("a");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect((await call("b")).status).toBe(200);
	});
});
