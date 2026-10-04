import { env } from "cloudflare:workers";
import type { Context, MiddlewareHandler } from "hono";
import type { RateLimiter } from "./rate-limiter-do.ts";

export type StrictLimit = "SIGN_IN" | "DEVICE_CODE" | "TOKENS" | "REPO_CREATE" | "REPORT" | "DEPLOY";

/**
 * #182: exact limits for sensitive actions, counted in a Durable Object per (limit, key).
 * Same 429 + Retry-After as rateLimit; the limit and period come from RATE_LIMIT_CONFIG.
 */
export async function strictHit(name: StrictLimit, key: string): Promise<{ success: boolean; retryAfter: number }> {
	const { limit, period } = env.RATE_LIMIT_CONFIG[name];
	const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${name}:${key}`)) as unknown as DurableObjectStub<RateLimiter>;
	return stub.hit(limit, period);
}

export function strictLimit<E extends object>(name: StrictLimit, keyOf: (c: Context<E>) => string): MiddlewareHandler<E> {
	return async (c, next) => {
		const { success, retryAfter } = await strictHit(name, keyOf(c));
		if (!success) {
			c.header("Retry-After", String(retryAfter));
			return c.json({ error: "rate_limited", retryAfter }, 429);
		}
		await next();
	};
}
