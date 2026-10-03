import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Checkpoints PRD "Redaction on the machine, before upload" (#115). One way: appmarket.org never
// receives the original text.

/** Secret formats, most specific first. Each match becomes [redacted:<kind>]. */
const PATTERNS: [kind: string, pattern: RegExp][] = [
	["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
	["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
	["openai", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
	["stripe", /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
	["github", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
	["aws", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
	["aws-secret", /(?<=aws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}/gi],
	["slack", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
	["cloudflare", /\b(?:cfat|cfut|cfk)_[A-Za-z0-9]{30,}/g],
	["artifacts", /\bart_v\d+_[A-Za-z0-9]{16,}/g],
	["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
	["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g],
	["connection-string", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi],
	["generic", /\b(?:sk|pk|api|key|token|secret)_[A-Za-z0-9]{24,}/gi],
];

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
	const patterns: [string, RegExp][] = [...PATTERNS, ...(opts.extra ?? []).map((src) => ["custom", new RegExp(src, "g")] as [string, RegExp])];
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
