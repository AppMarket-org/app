import { describe, expect, it } from "vitest";
import { repoInputSchema } from "./schemas";

const base = { name: "App", summary: "A summary that is long enough", category: "ai" };

describe("import fields (#30)", () => {
	it("accept public GitHub addresses and branch names only", () => {
		expect(repoInputSchema.parse({ ...base, importUrl: "https://github.com/octocat/Hello-World", importBranch: "test" })).toMatchObject({ importUrl: "https://github.com/octocat/Hello-World", importBranch: "test" });
		expect(repoInputSchema.parse({ ...base, importUrl: "" }).importUrl).toBeUndefined();
		for (const url of ["http://github.com/a/b", "https://evil.example/a/b", "https://github.com/a", "https://github.com/a/b/../../x", "file:///etc/passwd"]) {
			expect(repoInputSchema.safeParse({ ...base, importUrl: url }).success, url).toBe(false);
		}
		expect(repoInputSchema.safeParse({ ...base, importUrl: "https://github.com/a/b", importBranch: "x; rm -rf /" }).success).toBe(false);
	});
});
