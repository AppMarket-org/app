import type { RuntimeLogEvent } from "@appmarket/shared";
import { call } from "./versions.ts";

interface CfEvent {
	timestamp?: number;
	$metadata?: { level?: string; message?: string; error?: string; trigger?: string };
	$workers?: { outcome?: string; event?: { request?: { method?: string; url?: string } } };
}

/**
 * #40 (D10): the newest runtime log events of one Worker from Workers Logs (Observability
 * telemetry API), read with the buyer's token (optional scope workers-observability.read).
 */
export async function runtimeLogs(fetcher: typeof fetch, token: string, accountId: string, worker: string, minutes: number, now = Date.now()): Promise<RuntimeLogEvent[]> {
	const result = await call<{ events?: { events?: CfEvent[] } | CfEvent[] }>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/workers/observability/telemetry/query`, {
		method: "POST",
		body: JSON.stringify({
			queryId: `appmarket-logs-${worker}`,
			timeframe: { from: now - minutes * 60_000, to: now },
			view: "events",
			limit: 100,
			dry: true,
			parameters: { datasets: [], filters: [{ key: "$workers.scriptName", operation: "eq", type: "string", value: worker }] },
		}),
	});
	const events = Array.isArray(result.events) ? result.events : (result.events?.events ?? []);
	return events
		.map((e) => {
			const request = e.$workers?.event?.request;
			return {
				timestamp: new Date(e.timestamp ?? 0).toISOString(),
				level: e.$metadata?.level ?? "info",
				message: e.$metadata?.message ?? e.$metadata?.error ?? "",
				trigger: e.$metadata?.trigger ?? (request?.method && request.url ? `${request.method} ${new URL(request.url).pathname}` : null),
				outcome: e.$workers?.outcome ?? null,
			};
		})
		.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
