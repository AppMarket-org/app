import type { Runtime } from "@appmarket/shared";

export interface RootEntry {
	name: string;
	type: string;
}

const WRANGLER = ["wrangler.json", "wrangler.jsonc", "wrangler.toml"];

/**
 * PRD R26: quick check that a submitted version's top-level files match the declared runtime.
 * Returns human-readable problems; empty means it looks right. Deeper checks belong to D2.
 */
export function checkRuntime(runtime: Runtime, root: RootEntry[]): string[] {
	const files = new Set(root.filter((e) => e.type !== "tree").map((e) => e.name));
	const dirs = new Set(root.filter((e) => e.type === "tree").map((e) => e.name));
	const hasWrangler = WRANGLER.some((f) => files.has(f));
	const needs = (ok: boolean, message: string) => (ok ? [] : [message]);
	const wranglerIssue = needs(hasWrangler, "Add a Wrangler config (wrangler.jsonc, wrangler.json or wrangler.toml) at the repo root.");

	switch (runtime) {
		case "workers-js":
			return [...wranglerIssue, ...needs(files.has("package.json"), "JavaScript/TypeScript apps need a package.json at the repo root.")];
		case "workers-python":
			return [...wranglerIssue, ...needs(files.has("pyproject.toml"), "Python Workers need a pyproject.toml at the repo root.")];
		case "workers-rust":
			return [...wranglerIssue, ...needs(files.has("Cargo.toml"), "Rust Workers need a Cargo.toml at the repo root.")];
		case "container":
			return [...wranglerIssue, ...needs(files.has("Dockerfile") || dirs.has("container"), "Container apps need a Dockerfile (or a container/ directory).")];
		case "static":
			return needs(
				files.has("index.html") || ["public", "dist", "build"].some((d) => dirs.has(d)) || hasWrangler,
				"Static sites need an index.html at the root, a public/, dist/ or build/ directory, or a Wrangler config with assets.",
			);
	}
}
