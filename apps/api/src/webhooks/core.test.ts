import { describe, expect, it } from "vitest";
import { parseRefs } from "../previews/refs";
import { changedRefs, deliveryRequest, hmacHex, type PushEvent, webhookUrlProblem } from "./core";

const pkt = (s: string) => (s.length + 4).toString(16).padStart(4, "0") + s;
const event: PushEvent = { event: "push", deliveryId: "d1", repo: "dev/app", ref: "refs/tags/v1.0.0", before: null, after: "b".repeat(40), remote: "https://git.example/app.git", token: "tok", tokenExpiresAt: "2026-10-05T00:00:00Z", sentAt: "2026-10-04T23:00:00Z" };

describe("push webhooks (#34)", () => {
	it("reads branches and peeled tags from the ref advertisement", () => {
		const a = "a".repeat(40);
		const tagObject = "c".repeat(40);
		const text = `${pkt("# service=git-upload-pack\n")}0000${pkt(`${a} HEAD\0caps\n`)}${pkt(`${a} refs/heads/main\n`)}${pkt(`${tagObject} refs/tags/v1\n`)}${pkt(`${a} refs/tags/v1^{}\n`)}0000`;
		expect(parseRefs(text)).toEqual({ "refs/heads/main": a, "refs/tags/v1": a });
	});

	it("delivers new and moved refs, not deletions", () => {
		expect(changedRefs({ "refs/heads/main": "1", "refs/heads/old": "2" }, { "refs/heads/main": "3", "refs/tags/v1": "4" })).toEqual([
			{ ref: "refs/heads/main", before: "1", after: "3" },
			{ ref: "refs/tags/v1", before: null, after: "4" },
		]);
	});

	it("only sends to public HTTPS hosts", () => {
		expect(webhookUrlProblem("https://ci.example.com/hooks/appmarket", "generic")).toBeNull();
		for (const bad of ["http://ci.example.com", "https://localhost/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://user:pass@ci.example.com", "https://staging.appmarket.org/api", "nope"]) {
			expect(webhookUrlProblem(bad, "generic"), bad).not.toBeNull();
		}
		expect(webhookUrlProblem("https://github.com/acme/app", "github")).toBeNull();
		expect(webhookUrlProblem("https://example.com/acme/app", "github")).not.toBeNull();
	});

	it("signs generic deliveries and sends GitHub repository_dispatch events", async () => {
		const generic = await deliveryRequest("generic", "https://ci.example.com/hook", event, { signing: "whsec_test" });
		const body = await generic.text();
		expect(generic.headers.get("X-Appmarket-Signature-256")).toBe(`sha256=${await hmacHex("whsec_test", body)}`);
		const gh = await deliveryRequest("github", "https://github.com/acme/app", event, { signing: "s", github: "ghp_x" });
		expect(gh.url).toBe("https://api.github.com/repos/acme/app/dispatches");
		expect(gh.headers.get("Authorization")).toBe("Bearer ghp_x");
		const payload = JSON.parse(await gh.text());
		expect(payload.event_type).toBe("appmarket-push");
		expect(Object.keys(payload.client_payload)).toHaveLength(10);
	});
});
