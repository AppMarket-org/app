import type { Runtime } from "@appmarket/shared";
import { readWrangler } from "./wrangler";

/**
 * How a version runs on Cloudflare, read from its top-level files and Wrangler config, so
 * developers never pick a runtime by hand. null when the repo has nothing to go on yet (empty).
 */
export function detectRuntime(rootFiles: string[], rootDirs: string[], files: Map<string, string>): Runtime | null {
	const has = (f: string) => rootFiles.includes(f);
	const wrangler = readWrangler(files);
	const config = wrangler && !("error" in wrangler) ? wrangler.config : null;
	const main = typeof config?.main === "string" ? config.main : null;
	if ((Array.isArray(config?.containers) && config.containers.length > 0) || (!config && (has("Dockerfile") || rootDirs.includes("container")))) return "container";
	if (has("Cargo.toml")) return "workers-rust";
	if (main?.endsWith(".py") || has("pyproject.toml")) return "workers-python";
	if (has("package.json") || (main && /\.[cm]?[jt]sx?$/.test(main))) return "workers-js";
	if (config?.assets || has("index.html") || ["public", "dist", "build"].some((d) => rootDirs.includes(d))) return "static";
	return null;
}

/** The files detectRuntime reads besides the root listing. */
export const RUNTIME_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"] as const;
