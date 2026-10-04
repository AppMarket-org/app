import { describe, expect, it } from "vitest";
import { languageOf, languageShares } from "./languages";

describe("languages", () => {
	it("maps files and skips generated or vendored ones", () => {
		expect(languageOf("src/index.ts")).toBe("TypeScript");
		expect(languageOf("web/App.TSX")).toBe("TypeScript");
		expect(languageOf("sandbox/Dockerfile")).toBe("Dockerfile");
		expect(languageOf("README.md")).toBeNull();
		expect(languageOf("package.json")).toBeNull();
		expect(languageOf("public/app.min.js")).toBeNull();
		expect(languageOf("dist/index.js")).toBeNull();
		expect(languageOf("vendor/lib.c")).toBeNull();
		expect(languageOf("worker-configuration.d.ts")).toBeNull();
	});

	it("rounds to exactly 100 and groups small languages as Other", () => {
		const shares = languageShares({ TypeScript: 9970, JavaScript: 30 });
		expect(shares).toEqual([
			{ name: "TypeScript", color: "#3178c6", percent: 99.7 },
			{ name: "JavaScript", color: "#f1e05a", percent: 0.3 },
		]);
		const mixed = languageShares({ TypeScript: 1, JavaScript: 1, CSS: 1, Shell: 0.001 });
		expect(mixed.reduce((t, s) => t + s.percent * 10, 0)).toBe(1000);
		expect(mixed.at(-1)).toMatchObject({ name: "Other", color: null });
		expect(languageShares(null)).toEqual([]);
	});
});
