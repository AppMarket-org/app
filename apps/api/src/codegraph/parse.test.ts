import { describe, expect, it } from "vitest";
import { parseJs, parsePython, resolveImport } from "./parse";

describe("code graph parsing (#240)", () => {
	it("finds top-level TypeScript symbols with lines and exports, ignoring comments", () => {
		const src = [
			"import { a } from './a.js';",
			"import type { T } from \"../types\";",
			"import * as fs from 'node:fs';",
			"/* export function hidden() {} */",
			"// export const alsoHidden = 1;",
			"export async function handler(req: Request) {",
			"  const inner = 1;",
			"}",
			"export default class Store {}",
			"interface Opts { a: number }",
			"export type Id = string;",
			"const local = 2;",
			"export { local, Opts as Options };",
			"export * from './reexport';",
			"const lazy = await import('./lazy');",
			"const cjs = require('./legacy.cjs');",
		].join("\n");
		const p = parseJs(src);
		expect(p.symbols).toEqual([
			{ name: "handler", kind: "function", line: 6, exported: true },
			{ name: "Store", kind: "class", line: 9, exported: true },
			{ name: "Opts", kind: "interface", line: 10, exported: true },
			{ name: "Id", kind: "type", line: 11, exported: true },
			{ name: "local", kind: "const", line: 12, exported: true },
			{ name: "lazy", kind: "const", line: 15, exported: false },
			{ name: "cjs", kind: "const", line: 16, exported: false },
		]);
		expect(p.imports.sort()).toEqual(["../types", "./a.js", "./lazy", "./legacy.cjs", "./reexport", "node:fs"]);
	});

	it("finds Python definitions and imports", () => {
		const p = parsePython(["import os, app.models as m", "from .utils import helper", "from . import views, forms", "MAX_SIZE = 10", "class User:", "    def name(self): ...", "def _private(): ...", "async def handle(): ..."].join("\n"));
		expect(p.symbols.map((s) => `${s.name}:${s.kind}:${s.line}:${s.exported}`)).toEqual(["MAX_SIZE:const:4:true", "User:class:5:true", "_private:function:7:false", "handle:function:8:true"]);
		expect(p.imports.sort()).toEqual([".forms", ".utils", ".views", "app.models", "os"]);
	});

	it("resolves relative imports to repo files, and leaves packages alone", () => {
		const files = new Set(["src/a.ts", "src/lib/index.ts", "src/types.ts", "src/legacy.cjs", "app/__init__.py", "app/utils.py", "app/models.py", "app/views/__init__.py"]);
		expect(resolveImport("src/b.ts", "./a.js", files)).toBe("src/a.ts");
		expect(resolveImport("src/b.ts", "./lib", files)).toBe("src/lib/index.ts");
		expect(resolveImport("src/x/c.ts", "../types", files)).toBe("src/types.ts");
		expect(resolveImport("src/b.ts", "./legacy.cjs", files)).toBe("src/legacy.cjs");
		expect(resolveImport("src/b.ts", "hono", files)).toBeNull();
		expect(resolveImport("src/b.ts", "../../../etc", files)).toBeNull();
		expect(resolveImport("app/views/__init__.py", "..utils", files)).toBe("app/utils.py");
		expect(resolveImport("app/__init__.py", ".views", files)).toBe("app/views/__init__.py");
		expect(resolveImport("main.py", "app.models", files)).toBe("app/models.py");
		expect(resolveImport("main.py", "os", files)).toBeNull();
	});
});
