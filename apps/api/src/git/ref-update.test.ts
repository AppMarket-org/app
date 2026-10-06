import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { refUpdateBody, refUpdateResult } from "./ref-update.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("refUpdateBody", () => {
	it("sends one command, a flush and a valid empty pack", () => {
		const body = Buffer.from(refUpdateBody("refs/heads/main", A, B));
		const command = `${A} ${B} refs/heads/main\0report-status\n`;
		const head = (command.length + 4).toString(16).padStart(4, "0") + command + "0000";
		expect(body.subarray(0, head.length).toString("latin1")).toBe(head);
		const pack = body.subarray(head.length);
		expect(pack.subarray(0, 12)).toEqual(Buffer.from([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0]));
		expect(pack.subarray(12).toString("hex")).toBe(createHash("sha1").update(pack.subarray(0, 12)).digest("hex"));
	});
});

describe("refUpdateResult", () => {
	// Reports as Artifacts returned them (tested against staging).
	it("reads ok, stale and errors", () => {
		expect(refUpdateResult("000eunpack ok\n0019ok refs/heads/main\n0000", "refs/heads/main")).toBe("ok");
		expect(refUpdateResult("000eunpack ok\n0023ng refs/heads/main stale ref\n0000", "refs/heads/main")).toBe("stale");
		expect(refUpdateResult("000eunpack ok\n0023ng refs/heads/main hook declined\n0000", "refs/heads/main")).toBe("error");
		expect(refUpdateResult("0013unpack bad pack\n0000", "refs/heads/main")).toBe("error");
		expect(refUpdateResult("000eunpack ok\n0019ok refs/heads/main-2\n0000", "refs/heads/main")).toBe("error");
	});
});
