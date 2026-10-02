import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onError } from "./errors.ts";

// Built at runtime so the repo secret scanner (check:secrets) does not flag a fixture.
const FAKE_TOKEN = `art_v1_${"a".repeat(20)}`;

describe("onError", () => {
	afterEach(() => vi.restoreAllMocks());
	const app = new Hono()
		.get("/boom", () => {
			throw new Error(`db failed with token ${FAKE_TOKEN}`);
		})
		.get("/teapot", () => {
			throw new HTTPException(418, { message: "teapot" });
		});
	app.onError(onError);

	it("logs a redacted error and returns a generic 500", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await app.request("/boom?sig=secret");
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: "internal" });
		const line = JSON.parse(spy.mock.calls[0]![0] as string);
		expect(line).toMatchObject({ event: "request.error", method: "GET", path: "/boom" });
		expect(JSON.stringify(line)).not.toMatch(/art_v1_|sig=secret/);
	});

	it("passes HTTP exceptions through", async () => {
		expect((await app.request("/teapot")).status).toBe(418);
	});
});
