import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.APPMARKET_HOME = mkdtempSync(join(tmpdir(), "am-queue-"));
process.env.APPMARKET_NO_KEYCHAIN = "1";
const { saveCredentials } = await import("./credentials.ts");
const { enqueue, flush, queued } = await import("./queue.ts");

const record = { commit: "c".repeat(40) } as never;
const API = "http://api.example.test";

afterEach(() => vi.unstubAllGlobals());

describe("queue", () => {
	it("keeps an item with backoff while offline, then uploads it", async () => {
		await saveCredentials({ api: API, token: "t", handle: "dev", device: "d" });
		enqueue(API, "dev/app", record);
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
		expect(await flush()).toEqual({ sent: 0, pending: 1, failed: 0 });
		const [item] = queued();
		expect(item!.attempts).toBe(1);
		expect(Date.parse(item!.nextAt)).toBeGreaterThan(Date.now() + 50_000);
		// Not due yet: a normal flush skips it; `appmarket sync` (all) retries now.
		expect((await flush()).pending).toBe(1);
		const ok = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
		vi.stubGlobal("fetch", ok);
		expect(await flush({ all: true })).toEqual({ sent: 1, pending: 0, failed: 0 });
		expect(ok.mock.calls[0]![0]).toBe(`${API}/api/repos/dev/app/checkpoints`);
		expect(queued()).toHaveLength(0);
	});

	it("drops records the server will never accept, and settles conflicts", async () => {
		enqueue(API, "dev/app", record);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"not_found"}', { status: 404 })));
		expect(await flush()).toEqual({ sent: 0, pending: 0, failed: 1 });
		enqueue(API, "dev/app", record);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"conflict"}', { status: 409 })));
		expect(await flush()).toEqual({ sent: 1, pending: 0, failed: 0 });
	});
});
