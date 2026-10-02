import type { Context, MiddlewareHandler } from "hono";

/**
 * PRD R20: Workers rate limiting. Rejects with 429 and Retry-After once `limiter` is exhausted for
 * the key `keyOf` returns. Limits count per Cloudflare location.
 */
export function rateLimit<E extends object>(limiter: () => RateLimit, keyOf: (c: Context<E>) => string, periodSeconds: number): MiddlewareHandler<E> {
	return async (c, next) => {
		const { success } = await limiter().limit({ key: keyOf(c) });
		if (!success) {
			c.header("Retry-After", String(periodSeconds));
			return c.json({ error: "rate_limited", retryAfter: periodSeconds }, 429);
		}
		await next();
	};
}

/** Client IP from Cloudflare's header; "local" in development. */
export const clientIp = (c: Context) => c.req.header("cf-connecting-ip") ?? "local";
