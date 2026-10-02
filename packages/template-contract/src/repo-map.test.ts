import { describe, expect, it } from "vitest";
import { buildRepoMap } from "./repo-map";

describe("buildRepoMap", () => {
	it("orients an agent: start here, bindings, layout", () => {
		const map = buildRepoMap({
			listingName: "Todo",
			tag: "v1.0.0",
			commit: "abc123",
			entries: [
				{ path: "AGENTS.md", type: "blob" },
				{ path: "src", type: "tree" },
				{ path: "src/index.ts", type: "blob" },
				{ path: "src/routes", type: "tree" },
				{ path: "src/routes/todos.ts", type: "blob" },
			],
			packageJson: JSON.stringify({ scripts: { dev: "wrangler dev", test: "vitest" } }),
			wranglerMain: "src/index.ts",
			manifest: { resources: [{ type: "d1", binding: "DB", name: "todo-db" }], envVars: [], secrets: ["API_KEY"] },
			hasAgentsMd: true,
		});
		expect(map).toContain("# Repository map: Todo v1.0.0");
		expect(map).toContain("- Worker entry: `src/index.ts`");
		expect(map).toContain("- `npm run test`: `vitest`");
		expect(map).toContain("- `DB`: d1 (todo-db)");
		expect(map).toContain("- Secrets: `API_KEY`");
		expect(map).toContain("src/\n  index.ts\n  routes/\n    todos.ts");
	});

	it("caps depth and length", () => {
		const entries = Array.from({ length: 600 }, (_, i) => ({ path: `f${i}.ts`, type: "blob" }));
		entries.push({ path: "a/b/c/d/e/deep.ts", type: "blob" });
		const map = buildRepoMap({ listingName: "Big", tag: "v1", commit: "c", entries, manifest: null, hasAgentsMd: false });
		expect(map).not.toContain("deep.ts");
		expect(map).toMatch(/… \d+ more entries not shown/);
	});
});
