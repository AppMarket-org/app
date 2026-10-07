import { HOSTNAME } from "@appmarket/shared";
import { describe, expect, it, vi } from "vitest";
import { attachDomain, domainErrorMessage, listDomains, listZones } from "./domains";
import { CloudflareApiError } from "./versions";

const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));

describe("custom domains (#39)", () => {
	it("validates hostnames, refusing wildcards", () => {
		for (const h of ["app.example.com", "example.com", "a.b.example.co.uk"]) expect(HOSTNAME.test(h), h).toBe(true);
		for (const h of ["*.example.com", "example", "-a.example.com", "a..example.com", "App.Example.com", `${"a".repeat(64)}.com`]) expect(HOSTNAME.test(h), h).toBe(false);
	});

	it("attaches with the Worker as the service and lists only its domains", async () => {
		const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
			init?.method === "PUT" ? ok({ id: "d1", hostname: "app.example.com", zone_name: "example.com" }) : ok([{ id: "d1", hostname: "app.example.com", zone_name: "example.com", service: "w" }, { id: "d2", hostname: "x.example.com", service: "other" }]),
		);
		expect(await attachDomain(fetcher as unknown as typeof fetch, "t", "acct", "w", "app.example.com", "z1")).toEqual({ id: "d1", hostname: "app.example.com", zoneName: "example.com" });
		const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(String(init.body))).toEqual({ hostname: "app.example.com", service: "w", environment: "production", zone_id: "z1" });
		expect((await listDomains(fetcher as unknown as typeof fetch, "t", "acct", "w")).map((d) => d.id)).toEqual(["d1"]);
	});

	it("skips the zone picker without zone.read and explains refusals", async () => {
		const denied = vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ message: "Authentication error" }] }), { status: 403 }));
		expect(await listZones(denied as unknown as typeof fetch, "t", "acct")).toBeNull();
		expect(domainErrorMessage(new CloudflareApiError(409, "Hostname 'app.example.com' already has externally managed DNS records (A, CNAME, etc)."), "app.example.com")).toMatch(/already has a DNS record/);
		expect(domainErrorMessage(new CloudflareApiError(400, "Could not find zone for hostname"), "app.nope.dev")).toMatch(/not on a Cloudflare zone/);
	});

	it("reads again once when Cloudflare answers a read with a 5xx, never a write", async () => {
		let n = 0;
		const flaky = vi.fn(async () => (n++ === 0 ? new Response("bad gateway", { status: 502 }) : ok([{ id: "d1", hostname: "app.example.com", service: "w" }])));
		expect((await listDomains(flaky as unknown as typeof fetch, "t", "acct", "w")).map((d) => d.id)).toEqual(["d1"]);
		expect(flaky).toHaveBeenCalledTimes(2);
		const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
		await expect(attachDomain(down as unknown as typeof fetch, "t", "acct", "w", "app.example.com", "z1")).rejects.toThrow();
		expect(down).toHaveBeenCalledTimes(1);
	});
});
