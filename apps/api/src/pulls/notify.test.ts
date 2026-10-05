import { describe, expect, it } from "vitest";
import { pullEmail } from "./notify-email";

describe("pull request email (#258)", () => {
	it("names the repo, number and actor, links the pull request, and escapes HTML", () => {
		const m = pullEmail({ repo: "dev/app", number: 7, title: "Fix <login>", actor: "Ada", what: "requested changes", excerpt: "Use <b>bcrypt</b>.", url: "https://appmarket.org/dev/app/pulls/7", unsubscribe: "https://u" });
		expect(m.subject).toBe("[dev/app] #7 Fix <login>");
		expect(m.text).toContain("Ada requested changes.");
		expect(m.text).toContain("View it: https://appmarket.org/dev/app/pulls/7");
		expect(m.html).toContain("Use &lt;b&gt;bcrypt&lt;/b&gt;.");
		expect(m.html).not.toContain("<b>bcrypt");
	});
});
