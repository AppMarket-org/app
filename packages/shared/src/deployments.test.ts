import { describe, expect, it } from "vitest";
import { deployAvailability } from "./deployments";

const base = {
	state: "published" as const,
	platforms: ["workers" as const],
	runtime: "workers-js" as const,
	manifest: { resources: [], envVars: [], secrets: [] },
	priceCents: 0,
};

describe("deployAvailability", () => {
	it("allows published free Workers apps with a manifest", () => {
		expect(deployAvailability(base)).toEqual({ ok: true });
		expect(deployAvailability({ ...base, runtime: "static" })).toEqual({ ok: true });
	});

	it("says why other listings cannot deploy", () => {
		expect(deployAvailability({ ...base, state: "draft" })).toEqual({ ok: false, reason: "not_published" });
		expect(deployAvailability({ ...base, platforms: ["download"] })).toEqual({ ok: false, reason: "platform" });
		expect(deployAvailability({ ...base, runtime: "workers-rust" })).toEqual({ ok: false, reason: "runtime" });
		expect(deployAvailability({ ...base, runtime: "container" })).toEqual({ ok: false, reason: "runtime" });
		expect(deployAvailability({ ...base, manifest: null })).toEqual({ ok: false, reason: "no_config" });
		expect(deployAvailability({ ...base, priceCents: 500 })).toEqual({ ok: false, reason: "paid" });
	});
});
