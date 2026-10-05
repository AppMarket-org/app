import { describe, expect, it } from "vitest";
import { impactEmail } from "./impact-email";

const item = (o: Partial<Parameters<typeof impactEmail>[0][number]> = {}) => ({ impactId: "i1", title: "lodash < 4.17.21: prototype pollution", guidance: "Upgrade lodash to 4.17.21 or later.", repo: "dev/app", detail: "declares lodash ^4.17.0", ...o });

describe("impact email (#230)", () => {
	it("names the impact and the repo, with guidance and links", () => {
		const m = impactEmail([item()], "https://appmarket.org", "https://appmarket.org/email/unsubscribe?u=1");
		expect(m.subject).toBe("lodash < 4.17.21: prototype pollution: dev/app affected");
		expect(m.text).toContain("dev/app (declares lodash ^4.17.0): https://appmarket.org/dev/app");
		expect(m.text).toContain("What to do: Upgrade lodash");
		expect(m.text).toContain("Stop them: https://appmarket.org/email/unsubscribe?u=1");
		expect(m.html).toContain("prototype pollution");
	});

	it("groups several impacts and repos, and escapes HTML", () => {
		const m = impactEmail([item(), item({ repo: "acme/web" }), item({ impactId: "i2", title: "<script>x</script>", repo: "dev/app" })], "https://appmarket.org", "https://u");
		expect(m.subject).toBe("2 notices affect your repos on appmarket.org");
		expect(m.html).not.toContain("<script>");
		expect(m.html).toContain("&lt;script&gt;");
		expect(m.text.split("\n").filter((l) => l.includes("- acme/web"))).toHaveLength(1);
	});
});
