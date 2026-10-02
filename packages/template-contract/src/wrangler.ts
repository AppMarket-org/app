import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

export type WranglerConfig = Record<string, unknown>;

/** The repo's Wrangler config, in the order Wrangler itself looks for it. */
export function readWrangler(files: Map<string, string>): { path: string; config: WranglerConfig } | { path: string; error: string } | null {
	for (const path of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
		const text = files.get(path);
		if (text === undefined) continue;
		try {
			if (path.endsWith(".toml")) return { path, config: parseToml(text) as WranglerConfig };
			const problems: ParseError[] = [];
			const config = parseJsonc(text, problems, { allowTrailingComma: true });
			if (problems.length > 0 || typeof config !== "object" || config === null || Array.isArray(config)) return { path, error: "invalid JSON" };
			return { path, config };
		} catch (e) {
			return { path, error: e instanceof Error ? e.message.split("\n")[0]! : "invalid TOML" };
		}
	}
	return null;
}
