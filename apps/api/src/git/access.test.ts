import { describe, expect, it } from "vitest";
import { credentialOf, isArtifactsToken, parseGitPath } from "./access";

const q = (s: string) => new URLSearchParams(s);

describe("git over appmarket.org", () => {
	it("recognises the smart HTTP endpoints only", () => {
		expect(parseGitPath("/dev/app.git/info/refs", q("service=git-upload-pack"), "GET")).toEqual({ owner: "dev", slug: "app", kind: "info/refs", service: "git-upload-pack" });
		expect(parseGitPath("/dev/app.git/git-receive-pack", q(""), "POST")).toEqual({ owner: "dev", slug: "app", kind: "service", service: "git-receive-pack" });
		expect(parseGitPath("/dev/my.app.git/git-upload-pack", q(""), "POST")?.slug).toBe("my.app");
		for (const [p, s, m] of [
			["/dev/app.git/info/refs", "", "GET"],
			["/dev/app.git/info/refs", "service=evil", "GET"],
			["/dev/app.git/git-upload-pack", "", "GET"],
			["/dev/app/info/refs", "service=git-upload-pack", "GET"],
			["/dev/app.git/objects/info/packs", "", "GET"],
			["/a/b/c.git/info/refs", "service=git-upload-pack", "GET"],
		] as const)
			expect(parseGitPath(p, q(s), m), `${m} ${p}?${s}`).toBeNull();
	});

	it("reads Basic and Bearer credentials", () => {
		expect(credentialOf(`Basic ${btoa("appmarket:secret-token")}`)).toBe("secret-token");
		expect(credentialOf(`Basic ${btoa("x:a:b")}`)).toBe("a:b");
		expect(credentialOf("Bearer art_v1_abc")).toBe("art_v1_abc");
		expect(credentialOf(`Basic ${btoa("user-only")}`)).toBeNull();
		expect(credentialOf("Basic !!!")).toBeNull();
		expect(credentialOf(undefined)).toBeNull();
		expect(isArtifactsToken("art_v1_abc")).toBe(true);
		expect(isArtifactsToken("Abc.def")).toBe(false);
	});
});
