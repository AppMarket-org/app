import { DurableObject } from "cloudflare:workers";
import { hit, type Window } from "./rate-window.ts";

/**
 * #182: an exact limiter for sensitive, low-volume actions (sign-in, device codes, Git tokens,
 * repo creation, reports, deploys). One object per (limit, key) handles its requests one at a
 * time, so counts are exact; the Workers rate limiting binding is per machine and eventually
 * consistent (on staging 109 of 150 burst requests passed a 10/min limit).
 */
export class RateLimiter extends DurableObject {
	async hit(limit: number, periodSeconds: number): Promise<{ success: boolean; retryAfter: number }> {
		const result = hit(await this.ctx.storage.get<Window>("w"), Date.now(), limit, periodSeconds * 1000);
		await this.ctx.storage.put("w", result.window);
		// Drop the state once the window is over, so idle keys cost nothing.
		await this.ctx.storage.setAlarm(result.window.start + periodSeconds * 1000 + 1000);
		return { success: result.success, retryAfter: result.retryAfter };
	}

	async alarm(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}
}
