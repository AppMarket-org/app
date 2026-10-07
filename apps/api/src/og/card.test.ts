import { describe, expect, it } from "vitest";
import { cardTree, clip, type SatoriNode } from "./card";

const IMAGES = { logo: "data:image/png;base64,AA", cow: "data:image/png;base64,BB" };

describe("social cards", () => {
	it("clips long text at a word with an ellipsis", () => {
		expect(clip("short", 10)).toBe("short");
		const long = clip("A todo app with sync, offline mode, sharing, reminders and a lot more", 40);
		expect(long.length).toBeLessThanOrEqual(40);
		expect(long.endsWith("…")).toBe(true);
		expect(clip("  spaced\n\nout  ", 20)).toBe("spaced out");
	});

	it("lays out the brand, title, subtitle and at most four non-empty tags", () => {
		const tree = cardTree({ title: "My App", subtitle: "Does things", tags: ["a/b", "", "AI", "Rust", "x", "y"] }, IMAGES);
		expect(tree.props.style).toMatchObject({ width: 1200, height: 630 });
		const json = JSON.stringify(tree);
		expect(json).toContain("My App");
		expect(json).toContain("Does things");
		const column = (tree.props.children as SatoriNode[])[1]!;
		const tags = (column.props.children as { props: { children: unknown[] } }[])[2]!.props.children;
		expect(tags).toHaveLength(4);
		expect(json).toContain("data:image/png;base64,BB");
	});

	it("puts the site card's tagline on a second, accent-coloured line", () => {
		const json = JSON.stringify(cardTree({ title: "A Git platform", highlight: "for agents and humans.", subtitle: "s", tags: ["A2A"] }, IMAGES));
		expect(json).toContain('{"style":{"color":"#f4b894"},"children":"for agents and humans."}');
	});
});
