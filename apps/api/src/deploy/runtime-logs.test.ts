import { describe, expect, it, vi } from "vitest";
import { runtimeLogs } from "./runtime-logs";

describe("runtime logs (#40)", () => {
	it("queries Workers Logs for one Worker and maps events newest first", async () => {
		const fetcher = vi.fn(async () =>
			new Response(
				JSON.stringify({
					success: true,
					result: {
						events: {
							events: [
								{ timestamp: 1000, $metadata: { level: "log", message: "hello", trigger: "GET /" }, $workers: { outcome: "ok" } },
								{ timestamp: 2000, $metadata: { level: "error", error: "boom" }, $workers: { outcome: "exception", event: { request: { method: "POST", url: "https://x.workers.dev/api?q=1" } } } },
							],
						},
					},
				}),
			),
		);
		const events = await runtimeLogs(fetcher as unknown as typeof fetch, "t", "acct", "my-app", 60, 10_000_000);
		expect(events.map((e) => [e.level, e.message, e.trigger, e.outcome])).toEqual([
			["error", "boom", "POST /api", "exception"],
			["log", "hello", "GET /", "ok"],
		]);
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/observability/telemetry/query");
		const body = JSON.parse(String(init.body));
		expect(body).toMatchObject({ view: "events", timeframe: { from: 10_000_000 - 3_600_000, to: 10_000_000 } });
		expect(body.parameters.filters[0]).toEqual({ key: "$workers.scriptName", operation: "eq", type: "string", value: "my-app" });
	});
});
