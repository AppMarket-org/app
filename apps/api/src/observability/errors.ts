import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logEvent } from "./log.ts";

/**
 * PRD R23: unhandled errors become one redacted log line (Workers Observability also tracks them as
 * Issues) and a generic 500, so stack traces and internals never reach clients.
 */
export const onError: ErrorHandler = (error, c) => {
	if (error instanceof HTTPException) return error.getResponse();
	logEvent("request.error", { method: c.req.method, path: new URL(c.req.url).pathname, ray: c.req.header("cf-ray"), error }, "error");
	return c.json({ error: "internal" }, 500);
};
