import { describe, expect, it } from "vitest";
import { checkRuntime } from "./runtime-check.ts";

const f = (...names: string[]) => names.map((name) => ({ name, type: "blob" }));
const d = (...names: string[]) => names.map((name) => ({ name, type: "tree" }));

describe("checkRuntime", () => {
	it("accepts a JS Worker with wrangler config and package.json", () => {
		expect(checkRuntime("workers-js", f("wrangler.jsonc", "package.json"))).toEqual([]);
	});

	it("explains every missing piece", () => {
		expect(checkRuntime("workers-js", f("README.md"))).toHaveLength(2);
		expect(checkRuntime("workers-python", f("wrangler.toml", "package.json"))).toEqual(["Python Workers need a pyproject.toml at the repo root."]);
		expect(checkRuntime("workers-rust", f("wrangler.toml", "Cargo.toml"))).toEqual([]);
	});

	it("accepts containers with a Dockerfile or container dir", () => {
		expect(checkRuntime("container", f("wrangler.jsonc", "Dockerfile"))).toEqual([]);
		expect(checkRuntime("container", [...f("wrangler.jsonc"), ...d("container")])).toEqual([]);
		expect(checkRuntime("container", f("wrangler.jsonc"))).toHaveLength(1);
	});

	it("accepts static sites in several layouts", () => {
		expect(checkRuntime("static", f("index.html"))).toEqual([]);
		expect(checkRuntime("static", d("dist"))).toEqual([]);
		expect(checkRuntime("static", f("README.md"))).toHaveLength(1);
		// a directory called index.html is not a page
		expect(checkRuntime("static", d("index.html"))).toHaveLength(1);
	});
});
