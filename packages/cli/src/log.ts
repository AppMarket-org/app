import { appendFileSync } from "node:fs";
import { ensureDirs, LOG_FILE } from "./config.ts";

/** Local log for hook paths, which must stay silent and never fail (C7). */
export function log(message: string, error?: unknown): void {
	try {
		ensureDirs();
		const detail = error instanceof Error ? ` ${error.message}` : error ? ` ${String(error)}` : "";
		appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}${detail}\n`, { mode: 0o600 });
	} catch {
		// Logging must never throw.
	}
}
