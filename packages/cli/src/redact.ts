import { SECRET_PATTERNS } from "@appmarket/shared";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Checkpoints PRD "Redaction on the machine, before upload" (#115). One way: appmarket.org never
// receives the original text.

/** Files whose contents never leave the machine: a tool that read them keeps only its name. */
const SENSITIVE_PATHS = [/(^|[/\\])\.env(\.|$)/, /\.pem$/, /\.key$/, /(^|[/\\])id_(rsa|ed25519|ecdsa)/, /\.p12$/, /(^|[/\\])\.dev\.vars/];

export interface Redactor {
	text(value: string): string;
	/** Whether a tool's arguments touch a sensitive path (then they are dropped). */
	sensitivePath(args: string): boolean;
	readonly count: number;
}

/** Values from the repo's .env* and .dev.vars* files, so a pasted secret is caught even without a known format. */
export function envValues(root: string): string[] {
	const values: string[] = [];
	let entries: string[] = [];
	try {
		entries = readdirSync(root).filter((f) => /^\.env(\..+)?$/.test(f) || /^\.dev\.vars(\..+)?$/.test(f));
	} catch {
		return values;
	}
	for (const file of entries) {
		if (/\.example$/.test(file)) continue;
		try {
			for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
				const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?(.*?)["']?\s*$/.exec(line);
				if (m && m[1]!.length >= 8) values.push(m[1]!);
			}
		} catch {
			// Unreadable: skip.
		}
	}
	return values;
}

/** `ignore` holds extra path patterns (.appmarketignore lines); `extra` holds custom regex sources. */
export function createRedactor(opts: { envValues?: string[]; extra?: string[]; ignore?: string[] } = {}): Redactor {
	let count = 0;
	const patterns: [string, RegExp][] = [...SECRET_PATTERNS, ...(opts.extra ?? []).map((src) => ["custom", new RegExp(src, "g")] as [string, RegExp])];
	const values = [...new Set(opts.envValues ?? [])].sort((a, b) => b.length - a.length);
	const ignore = (opts.ignore ?? []).filter(Boolean).map((glob) => new RegExp(glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")));
	return {
		text(value: string): string {
			let out = value;
			for (const secret of values) {
				if (out.includes(secret)) {
					count += out.split(secret).length - 1;
					out = out.split(secret).join("[redacted:env]");
				}
			}
			for (const [kind, pattern] of patterns) {
				out = out.replace(pattern, () => {
					count++;
					return `[redacted:${kind}]`;
				});
			}
			return out;
		},
		sensitivePath(args: string): boolean {
			return SENSITIVE_PATHS.some((p) => p.test(args)) || ignore.some((p) => p.test(args));
		},
		get count() {
			return count;
		},
	};
}
