/** #182: a fixed-window counter (pure, so it is unit-testable). */
export interface Window {
	start: number;
	count: number;
}

export function hit(window: Window | undefined, now: number, limit: number, periodMs: number): { window: Window; success: boolean; retryAfter: number } {
	const current = window && now - window.start < periodMs ? window : { start: now, count: 0 };
	if (current.count >= limit) return { window: current, success: false, retryAfter: Math.ceil((current.start + periodMs - now) / 1000) };
	return { window: { start: current.start, count: current.count + 1 }, success: true, retryAfter: 0 };
}
