// PRD R23: structured logs for Workers Observability. Each line is one JSON object with an `event`
// name, so the dashboard can filter, count and chart events (docs/observability.md). Values are
// redacted before logging: tokens, secrets and credentials never reach the logs.

/** Field names whose values are never logged. */
const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|api[_-]?key|signature|^sig$|^code$|^state$|verifier/i;
/** Credentials that can appear inside free text such as error messages. */
const SECRET_TEXT: RegExp[] = [
	/art_v\d+_[A-Za-z0-9]+/g, // Artifacts repo tokens
	/Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
	/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // JWTs
	/https:\/\/[^\s"']*[?&](token|sig|signature|code|state)=[^\s"'&]*/gi, // URLs carrying credentials
];

export function redactText(text: string): string {
	return SECRET_TEXT.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
}

export function redact(value: unknown, depth = 0): unknown {
	if (typeof value === "string") return redactText(value);
	if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: value.stack ? redactText(value.stack) : undefined };
	if (depth > 4 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]));
}

type Level = "info" | "warn" | "error";

/** One structured log line. `event` is a stable dotted name, e.g. `repo.created`. */
export function logEvent(event: string, fields: Record<string, unknown> = {}, level: Level = "info"): void {
	const line = JSON.stringify({ event, ...(redact(fields) as Record<string, unknown>) });
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}
