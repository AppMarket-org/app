// UI conventions for apps/web (owner's rules): no px anywhere, use rem; interactive and list/table
// widgets must be Angular Material components. Layout and text elements (div, p, h1-h6, section, ...)
// and <pre>/<code> (Material has no code block) are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "apps/web/src";
const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path);
		else if (/\.(scss|html|ts)$/.test(name) && !name.endsWith(".spec.ts")) files.push(path);
	}
};
walk(ROOT);

const problems = [];
const report = (file, index, text, message) => {
	const line = text.slice(0, index).split("\n").length;
	problems.push(`${relative(".", file)}:${line}: ${message}`);
};

// A plain element is allowed only when it carries one of these Material directives.
const NEEDS_MATERIAL = {
	button: /\bmat-(?:button|flat-button|stroked-button|raised-button|icon-button|fab|mini-fab|menu-item)\b|\bmatButton\b/,
	a: /\bmat-(?:button|flat-button|stroked-button|raised-button|icon-button|chip|list-item|menu-item)\b|\bmatButton\b|\bmat-tab-link\b/,
	input: /\bmatInput\b|\btype="file"[^>]*\bhidden\b|\bhidden\b[^>]*\btype="file"/,
	textarea: /\bmatInput\b/,
	select: /\bmatNativeControl\b/,
	table: /\bmat-table\b/,
};
const FORBIDDEN = { ul: "use mat-list", ol: "use mat-list", dl: "use mat-list" };

for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/(?<![\w-])\d*\.?\d+px\b/g)) report(file, m.index, text, `"${m[0]}" uses px; use rem or a Material token`);
	if (!file.endsWith(".html")) continue;
	for (const m of text.matchAll(/<(button|a|input|textarea|select|table|ul|ol|dl)\b([^>]*)>/g)) {
		const [, tag, attrs] = m;
		if (FORBIDDEN[tag]) report(file, m.index, text, `<${tag}> is not a Material component; ${FORBIDDEN[tag]}`);
		else if (!NEEDS_MATERIAL[tag].test(attrs)) report(file, m.index, text, `<${tag}> without a Material directive${tag === "table" ? " (use mat-table)" : ""}`);
	}
	// (ngSubmit) only fires on an Angular form: [formGroup], or NgForm from FormsModule. Otherwise the
	// browser submits natively and reloads the page (the username and device-code forms once did).
	for (const m of text.matchAll(/<form\b([^>]*)>/g)) {
		if (!/\(ngSubmit\)/.test(m[1]) || /\[formGroup\]/.test(m[1])) continue;
		const component = (() => {
			try {
				return readFileSync(file.replace(/\.html$/, ".ts"), "utf8");
			} catch {
				return "";
			}
		})();
		if (!/\bFormsModule\b/.test(component)) report(file, m.index, text, "<form (ngSubmit)> needs [formGroup] (or FormsModule), or the browser reloads the page on submit");
	}
}

if (problems.length > 0) {
	console.error(problems.join("\n"));
	console.error(`\n${problems.length} UI convention problem(s).`);
	process.exit(1);
}
console.log("UI conventions OK");
