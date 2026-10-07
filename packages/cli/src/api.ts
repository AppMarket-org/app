import { VERSION } from "./config.ts";

export class ApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, body: unknown) {
		super(`HTTP ${status}`);
		this.status = status;
		this.body = body;
	}
}

/** JSON request to the appmarket.org API; `token` is the device session (Authorization: Bearer). */
export async function call<T>(api: string, path: string, init: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
	const response = await fetch(api + path, {
		method: init.method ?? (init.body === undefined ? "GET" : "POST"),
		headers: {
			"user-agent": `appmarket-cli/${VERSION} (${process.platform}; ${process.arch})`,
			...(init.body === undefined ? {} : { "content-type": "application/json" }),
			...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
	});
	const text = await response.text();
	let body: unknown = text;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		// Not JSON.
	}
	if (!response.ok) throw new ApiError(response.status, body);
	return body as T;
}
