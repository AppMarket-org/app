import { describe, expect, it } from "vitest";
import { pickBranch } from "./pick-branch";

const b = (...names: string[]) => names.map((name) => ({ name, sha: `${name}-sha` }));

describe("code browser branch", () => {
	it("prefers the default branch, then main, master and the rest by name", () => {
		expect(pickBranch("main", b("dev", "main"))?.name).toBe("main");
		expect(pickBranch("trunk", b("main", "trunk"))?.name).toBe("trunk");
		// Code pushed to master while the repo's default is main (ng new does this).
		expect(pickBranch("main", b("master", "feature"))?.name).toBe("master");
		expect(pickBranch("main", b("zeta", "alpha"))?.name).toBe("alpha");
		expect(pickBranch("main", [])).toBeNull();
	});
});
