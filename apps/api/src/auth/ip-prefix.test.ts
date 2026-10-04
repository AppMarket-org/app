import { describe, expect, it } from "vitest";
import { ipPrefix } from "./ip-prefix.ts";

describe("ipPrefix (#133)", () => {
	it("keeps only the network part", () => {
		expect(ipPrefix("203.0.113.42")).toBe("203.0.113.0/24");
		expect(ipPrefix("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::/48");
		expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
		expect(ipPrefix(null)).toBeNull();
		expect(ipPrefix("not-an-ip")).toBeNull();
	});
});
