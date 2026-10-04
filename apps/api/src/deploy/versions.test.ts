import { describe, expect, it, vi } from "vitest";
import { CloudflareApiError, rollbackTo, workerVersions } from "./versions";

const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });

describe("worker versions (#38)", () => {
	it("lists versions newest first with the live traffic share", async () => {
		const fetcher = vi.fn(async (url: string | URL | Request) =>
			String(url).includes("/versions")
				? ok({ items: [
						{ id: "v1", number: 1, metadata: { created_on: "2026-10-01T00:00:00Z", source: "wrangler" } },
						{ id: "v2", number: 2, metadata: { created_on: "2026-10-02T00:00:00Z", source: "api" }, annotations: { "workers/message": "Rolled back via appmarket.org" } },
					] })
				: ok({ deployments: [{ versions: [{ version_id: "v1", percentage: 100 }] }, { versions: [{ version_id: "v2", percentage: 100 }] }] }),
		);
		const list = await workerVersions(fetcher as typeof fetch, "t", "acct", "my app");
		expect(list.map((v) => [v.id, v.percentage])).toEqual([["v2", 0], ["v1", 100]]);
		expect(list[0]!.message).toBe("Rolled back via appmarket.org");
		expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/my%20app/versions?per_page=20");
	});

	it("rolls back by sending all traffic to one version and surfaces API errors", async () => {
		const fetcher = vi.fn(async () => ok({}));
		await rollbackTo(fetcher as unknown as typeof fetch, "t", "acct", "app", "v1");
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toMatch(/\/workers\/scripts\/app\/deployments$/);
		expect(JSON.parse(String(init.body))).toMatchObject({ strategy: "percentage", versions: [{ version_id: "v1", percentage: 100 }] });

		const failing = vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ message: "version not found" }] }), { status: 404 }));
		await expect(rollbackTo(failing as unknown as typeof fetch, "t", "a", "w", "x")).rejects.toEqual(new CloudflareApiError(404, "version not found"));
	});
});
