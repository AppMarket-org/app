import { describe, expect, it } from "vitest";
import { detectRuntime } from "./runtime";

const w = (config: Record<string, unknown>) => new Map([["wrangler.json", JSON.stringify({ name: "x", compatibility_date: "2026-01-01", ...config })]]);

describe("detectRuntime", () => {
	it("reads the runtime from the code", () => {
		expect(detectRuntime(["package.json", "wrangler.jsonc"], ["src"], w({ main: "src/index.ts" }))).toBe("workers-js");
		expect(detectRuntime(["package.json", "angular.json"], ["src"], new Map())).toBe("workers-js");
		expect(detectRuntime(["pyproject.toml", "wrangler.toml"], ["src"], w({ main: "src/entry.py" }))).toBe("workers-python");
		expect(detectRuntime(["Cargo.toml", "wrangler.toml", "package.json"], ["src"], w({ main: "build/index.js" }))).toBe("workers-rust");
		expect(detectRuntime(["Dockerfile", "wrangler.jsonc", "package.json"], [], w({ main: "src/index.ts", containers: [{ class_name: "A", image: "x" }] }))).toBe("container");
		expect(detectRuntime(["Dockerfile"], [], new Map())).toBe("container");
		expect(detectRuntime(["index.html", "style.css"], [], new Map())).toBe("static");
		expect(detectRuntime(["wrangler.json"], ["public"], w({ assets: { directory: "./public" } }))).toBe("static");
		expect(detectRuntime(["README.md"], [], new Map())).toBeNull();
	});
});
