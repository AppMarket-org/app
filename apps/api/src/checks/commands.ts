import { SECRET_PATTERNS } from "@appmarket/shared";

/**
 * #27: shell commands for the checks. Every check exits 0 and prints a marker line with its
 * result (passed, failed or skipped), so one failing check never hides the others.
 */
export const CHECKS = ["lint", "typecheck", "test", "security"] as const;
export type CheckName = (typeof CHECKS)[number];
export type CheckStatus = "passed" | "failed" | "skipped";
export interface CheckResult {
	/** "install" when installing dependencies failed (no check could run). */
	name: CheckName | "install";
	status: CheckStatus;
	/** The last 4 KB of output. */
	output: string;
}

const MARKER = "APPMARKET_CHECK_RESULT=";

export const installCommand = [
	"set -e",
	"if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile",
	"elif [ -f package-lock.json ]; then npm ci",
	"elif [ -f package.json ]; then npm install",
	"fi",
].join("; ");

/** Runs `body` as a check: a skip test first, then the command; output trimmed, marker last. */
function wrap(skipIf: string, body: string): string {
	return [
		`if ${skipIf}; then echo "${MARKER}skipped"; exit 0; fi`,
		`out=$( { ${body} ; } 2>&1 ); code=$?`,
		`printf '%s\\n' "$out" | tail -c 4000`,
		`if [ $code -eq 0 ]; then echo "${MARKER}passed"; else echo "${MARKER}failed"; fi`,
		"exit 0",
	].join("\n");
}

const hasScript = (name: string) => `node -e "const s=require('./package.json').scripts||{};process.exit(s['${name}']&&!/no test specified/.test(s['${name}'])?0:1)"`;
const run = (name: string) => `if [ -f pnpm-lock.yaml ]; then pnpm run -s ${name}; else npm run -s ${name}; fi`;

/** A secret scan of the checkout with the same patterns as checkpoint redaction (#128). */
function secretScan(): string {
	const patterns = JSON.stringify(SECRET_PATTERNS.map(([kind, re]) => [kind, re.source]));
	// Walks the checkout (it is not a Git working tree in the container), skipping dependencies and build output.
	const script = `const fs=require('fs');const path=require('path');const P=${patterns}.map(([k,s])=>[k,new RegExp(s)]);const SKIP=new Set(['node_modules','.git','dist','build','.wrangler','.next','coverage']);let hits=0;const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory()){if(!SKIP.has(e.name))walk(f);continue}if(!e.isFile())continue;let t;try{if(fs.statSync(f).size>1e6)continue;t=fs.readFileSync(f,'utf8')}catch{continue}for(const [k,r] of P){if(r.test(t)){hits++;console.log('possible '+k+' secret in '+path.relative('.',f))}}}};walk('.');process.exit(hits?1:0)`;
	return `node -e ${JSON.stringify(script).replace(/\$/g, "\\$")}`;
}

export function checkCommand(name: CheckName): string {
	switch (name) {
		case "lint":
			return wrap(`[ ! -f package.json ] || ! ${hasScript("lint")}`, run("lint"));
		case "typecheck":
			// A typecheck script, else tsc when the repo has a tsconfig and TypeScript installed.
			return wrap(
				`[ ! -f package.json ] || { ! ${hasScript("typecheck")} && { [ ! -f tsconfig.json ] || [ ! -x node_modules/.bin/tsc ]; }; }`,
				`if ${hasScript("typecheck")}; then ${run("typecheck")}; else node_modules/.bin/tsc --noEmit; fi`,
			);
		case "test":
			return wrap(`[ ! -f package.json ] || ! ${hasScript("test")}`, `export CI=1; ${run("test")}`);
		case "security":
			// Known-vulnerable production dependencies (high and critical) and committed secrets.
			return wrap(
				"false",
				`${secretScan()} && if [ -f pnpm-lock.yaml ]; then pnpm audit --prod --audit-level high; elif [ -f package-lock.json ]; then npm audit --omit=dev --audit-level=high; fi`,
			);
	}
}

/** Reads a check's result from its stdout. */
export function parseCheck(name: CheckName, stdout: string): CheckResult {
	const marker = stdout.lastIndexOf(MARKER);
	const status = (marker >= 0 ? stdout.slice(marker + MARKER.length).trim().split(/\s/)[0] : "failed") as CheckStatus;
	const output = (marker >= 0 ? stdout.slice(0, marker) : stdout).trim().slice(-4000);
	return { name, status: ["passed", "failed", "skipped"].includes(status) ? status : "failed", output };
}
