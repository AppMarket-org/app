import { describe, expect, it } from "vitest";
import { updatedRefs, withMessages } from "./sideband";

const enc = new TextEncoder();
const pkt = (s: string | Uint8Array) => {
	const body = typeof s === "string" ? enc.encode(s) : s;
	return new Uint8Array([...enc.encode((body.length + 4).toString(16).padStart(4, "0")), ...body]);
};
const band = (n: number, inner: Uint8Array) => pkt(new Uint8Array([n, ...inner]));
const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const FLUSH = enc.encode("0000");

/** What git-receive-pack answers with side-band-64k: report-status inside channel 1. */
const report = (...lines: string[]) => concat(band(1, concat(...lines.map((l) => pkt(`${l}\n`)), FLUSH)), FLUSH);

describe("push messages (#260)", () => {
	it("reads the updated refs from a side-band report-status", () => {
		expect(updatedRefs(report("unpack ok", "ok refs/heads/feature/x", "ng refs/heads/main non-fast-forward", "ok refs/tags/v1"))).toEqual(["refs/heads/feature/x", "refs/tags/v1"]);
		expect(updatedRefs(concat(pkt("unpack ok\n"), pkt("ok refs/heads/x\n"), FLUSH))).toEqual([]);
	});

	it("adds channel 2 lines before the final flush, which git prints as remote: lines", () => {
		const original = report("unpack ok", "ok refs/heads/feature/x");
		const out = withMessages(original, ["Create a pull request:", "  https://appmarket.org/dev/app/pulls/new"]);
		const text = new TextDecoder().decode(out);
		expect(text.endsWith("0000")).toBe(true);
		expect(text).toContain("\u0002Create a pull request:\n");
		expect(updatedRefs(out)).toEqual(["refs/heads/feature/x"]);
		const plain = concat(pkt("unpack ok\n"), FLUSH);
		expect(withMessages(plain, ["x"])).toBe(plain);
	});
});
