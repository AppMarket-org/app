/**
 * #240: a light code graph for agents. Per file: top-level symbols (with line numbers) and the
 * imports that resolve to other files of the repo. Regex scanning, not a compiler: it covers the
 * common forms of TypeScript/JavaScript and Python and ignores the rest, which is enough for
 * "where is X defined", "who imports this file" and lease conflict hints.
 */
export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "const" | "variable";

export interface CodeSymbol {
	name: string;
	kind: SymbolKind;
	line: number;
	exported: boolean;
}

export interface ParsedFile {
	symbols: CodeSymbol[];
	/** Import specifiers as written (relative ones are resolved later). */
	imports: string[];
}

const JS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PY_EXT = /\.py$/;

export const languageOf = (path: string): "js" | "py" | null => (JS_EXT.test(path) && !path.endsWith(".d.ts") ? "js" : PY_EXT.test(path) ? "py" : null);

/** Strips comments and string contents while keeping line breaks and positions roughly in place. */
function stripJs(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export function parseJs(src: string): ParsedFile {
	const code = stripJs(src);
	const symbols: CodeSymbol[] = [];
	const lines = code.split("\n");
	const decl = /^(export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(function\*?|class|abstract\s+class|interface|type|enum|const\s+enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
	lines.forEach((line, i) => {
		const m = decl.exec(line);
		if (!m) return;
		const raw = m[2]!.replace(/\s+/g, " ");
		const kind: SymbolKind = raw.startsWith("function") ? "function" : raw.includes("class") ? "class" : raw === "interface" ? "interface" : raw === "type" ? "type" : raw.includes("enum") ? "enum" : raw === "const" ? "const" : "variable";
		symbols.push({ name: m[3]!, kind, line: i + 1, exported: !!m[1] });
	});
	// export { a, b as c } marks local symbols exported.
	for (const m of code.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
		for (const part of m[1]!.split(",")) {
			const local = part.trim().split(/\s+as\s+/)[0]?.trim();
			const s = symbols.find((x) => x.name === local);
			if (s) s.exported = true;
		}
	}
	const imports = new Set<string>();
	const patterns = [
		/\bimport\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g,
		/\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g,
		/\brequire\(\s*["']([^"'\n]+)["']\s*\)/g,
		/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g,
	];
	for (const p of patterns) for (const m of src.matchAll(p)) imports.add(m[1]!);
	return { symbols, imports: [...imports] };
}

export function parsePython(src: string): ParsedFile {
	const symbols: CodeSymbol[] = [];
	const imports = new Set<string>();
	src.split("\n").forEach((line, i) => {
		let m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
		if (m) return void symbols.push({ name: m[1]!, kind: "function", line: i + 1, exported: !m[1]!.startsWith("_") });
		m = /^class\s+([A-Za-z_]\w*)/.exec(line);
		if (m) return void symbols.push({ name: m[1]!, kind: "class", line: i + 1, exported: !m[1]!.startsWith("_") });
		m = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/.exec(line);
		if (m) return void symbols.push({ name: m[1]!, kind: "const", line: i + 1, exported: true });
		m = /^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)/.exec(line);
		if (m) {
			// "from . import a, b" imports modules a and b of the package.
			if (/^\.+$/.test(m[1]!)) for (const name of m[2]!.replace(/[()]/g, "").split(",")) imports.add(`${m[1]}${name.trim().split(/\s+as\s+/)[0]}`);
			else imports.add(m[1]!);
			return;
		}
		m = /^\s*import\s+(.+)/.exec(line);
		if (m) for (const name of m[1]!.split(",")) imports.add(name.trim().split(/\s+as\s+/)[0]!);
	});
	return { symbols, imports: [...imports] };
}

export function parseFile(path: string, src: string): ParsedFile | null {
	const lang = languageOf(path);
	return lang === "js" ? parseJs(src) : lang === "py" ? parsePython(src) : null;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function normalize(path: string): string | null {
	const out: string[] = [];
	for (const seg of path.split("/")) {
		if (!seg || seg === ".") continue;
		if (seg === "..") {
			if (!out.length) return null;
			out.pop();
		} else out.push(seg);
	}
	return out.join("/");
}

const JS_TRIES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

/** The repo file an import refers to, or null for packages and anything outside the repo. */
export function resolveImport(from: string, specifier: string, files: ReadonlySet<string>): string | null {
	if (languageOf(from) === "py") {
		const dots = /^\.*/.exec(specifier)![0].length;
		const rest = specifier.slice(dots).replace(/\./g, "/");
		let base: string | null;
		if (dots === 0) base = rest;
		else {
			let dir = dirOf(from);
			for (let i = 1; i < dots; i++) dir = dirOf(dir);
			base = normalize(`${dir}/${rest}`);
		}
		if (base === null) return null;
		const candidates = dots === 0 ? [`${base}.py`, `${base}/__init__.py`, `src/${base}.py`, `src/${base}/__init__.py`] : [`${base}.py`, `${base}/__init__.py`];
		return candidates.find((c) => files.has(c)) ?? null;
	}
	if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
	const joined = normalize(specifier.startsWith("/") ? specifier : `${dirOf(from)}/${specifier}`);
	if (joined === null) return null;
	// TypeScript ESM writes "./x.js" for "./x.ts".
	const stems = /\.(m|c)?js$/.test(joined) ? [joined, joined.replace(/\.(m|c)?js$/, "")] : [joined];
	for (const stem of stems) for (const ext of JS_TRIES) if (files.has(stem + ext)) return stem + ext;
	return null;
}
