/**
 * #170: languages by file extension or name, with GitHub Linguist's names and colours. Like
 * GitHub's bar, only programming and markup languages count (no JSON, YAML, Markdown or other
 * data and prose).
 */
export const LANGUAGES: Record<string, { color: string; extensions?: string[]; filenames?: string[] }> = {
	TypeScript: { color: "#3178c6", extensions: [".ts", ".tsx", ".mts", ".cts"] },
	JavaScript: { color: "#f1e05a", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
	Python: { color: "#3572A5", extensions: [".py", ".pyi"] },
	Rust: { color: "#dea584", extensions: [".rs"] },
	Go: { color: "#00ADD8", extensions: [".go"] },
	HTML: { color: "#e34c26", extensions: [".html", ".htm"] },
	CSS: { color: "#663399", extensions: [".css"] },
	SCSS: { color: "#c6538c", extensions: [".scss"] },
	Sass: { color: "#a53b70", extensions: [".sass"] },
	Less: { color: "#1d365d", extensions: [".less"] },
	Vue: { color: "#41b883", extensions: [".vue"] },
	Svelte: { color: "#ff3e00", extensions: [".svelte"] },
	Astro: { color: "#ff5a03", extensions: [".astro"] },
	MDX: { color: "#fcb32c", extensions: [".mdx"] },
	Shell: { color: "#89e051", extensions: [".sh", ".bash", ".zsh"] },
	PowerShell: { color: "#012456", extensions: [".ps1"] },
	Dockerfile: { color: "#384d54", filenames: ["Dockerfile"] },
	Makefile: { color: "#427819", filenames: ["Makefile", "makefile", "GNUmakefile"] },
	SQL: { color: "#e38c00", extensions: [".sql"] },
	Java: { color: "#b07219", extensions: [".java"] },
	Kotlin: { color: "#A97BFF", extensions: [".kt", ".kts"] },
	Swift: { color: "#F05138", extensions: [".swift"] },
	"Objective-C": { color: "#438eff", extensions: [".m"] },
	C: { color: "#555555", extensions: [".c", ".h"] },
	"C++": { color: "#f34b7d", extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"] },
	"C#": { color: "#178600", extensions: [".cs"] },
	Ruby: { color: "#701516", extensions: [".rb"] },
	PHP: { color: "#4F5D95", extensions: [".php"] },
	Dart: { color: "#00B4AB", extensions: [".dart"] },
	Lua: { color: "#000080", extensions: [".lua"] },
	Zig: { color: "#ec915c", extensions: [".zig"] },
	Elixir: { color: "#6e4a7e", extensions: [".ex", ".exs"] },
	Haskell: { color: "#5e5086", extensions: [".hs"] },
	Scala: { color: "#c22d40", extensions: [".scala"] },
	Clojure: { color: "#db5855", extensions: [".clj", ".cljs", ".cljc"] },
	Elm: { color: "#60B5CC", extensions: [".elm"] },
	Solidity: { color: "#AA6746", extensions: [".sol"] },
	WebAssembly: { color: "#04133b", extensions: [".wat"] },
	GLSL: { color: "#5686a5", extensions: [".glsl", ".vert", ".frag"] },
	WGSL: { color: "#1a5e9a", extensions: [".wgsl"] },
};

const BY_EXTENSION = new Map<string, string>();
const BY_FILENAME = new Map<string, string>();
for (const [name, l] of Object.entries(LANGUAGES)) {
	for (const ext of l.extensions ?? []) BY_EXTENSION.set(ext, name);
	for (const file of l.filenames ?? []) BY_FILENAME.set(file, name);
}

/** Generated, vendored or minified files that do not count (directory names are skipped by the walk). */
const IGNORED = [/\.min\.(js|css)$/, /\.map$/, /(^|\/)(vendor|vendored|third_party|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|generated)\//, /\.d\.ts$/, /\.generated\.\w+$/, /(^|\/)worker-configuration\.d\.ts$/];

/** The language of a file path, or null when it does not count. */
export function languageOf(path: string): string | null {
	if (IGNORED.some((re) => re.test(path))) return null;
	const name = path.slice(path.lastIndexOf("/") + 1);
	const byName = BY_FILENAME.get(name);
	if (byName) return byName;
	const dot = name.lastIndexOf(".");
	return dot > 0 ? (BY_EXTENSION.get(name.slice(dot).toLowerCase()) ?? null) : null;
}

export interface LanguageShare {
	name: string;
	/** Linguist colour; "Other" gets null (drawn in a neutral theme colour). */
	color: string | null;
	/** One decimal; the shares of a repo add up to exactly 100. */
	percent: number;
}

/**
 * Bytes per language → shares for display: largest first, languages under 0.1% (and beyond the
 * top 7) grouped as Other, rounded with largest remainders so the total is exactly 100.0.
 */
export function languageShares(bytes: Record<string, number> | null | undefined, top = 7): LanguageShare[] {
	const entries = Object.entries(bytes ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
	const total = entries.reduce((t, [, n]) => t + n, 0);
	if (!total) return [];
	const shown: [string, number][] = [];
	let other = 0;
	for (const [name, n] of entries) {
		if (shown.length < top && n / total >= 0.001) shown.push([name, n]);
		else other += n;
	}
	if (other) shown.push(["Other", other]);
	// Largest remainder in tenths of a percent.
	const raw = shown.map(([, n]) => (n / total) * 1000);
	const floors = raw.map(Math.floor);
	let left = 1000 - floors.reduce((a, b) => a + b, 0);
	const order = raw.map((r, i) => [r - floors[i]!, i] as const).sort((a, b) => b[0] - a[0]);
	for (const [, i] of order) {
		if (left <= 0) break;
		floors[i]!++;
		left--;
	}
	return shown.map(([name], i) => ({ name, color: name === "Other" ? null : (LANGUAGES[name]?.color ?? null), percent: floors[i]! / 10 }));
}
