/**
 * Checkpoints PRD "Redaction": secret formats, most specific first. Shared by the CLI (before
 * upload) and the API (again on every upload and before anything becomes visible, #128), so an
 * outdated CLI cannot leak a format added later. Each match becomes [redacted:<kind>].
 */
export const SECRET_PATTERNS: [kind: string, pattern: RegExp][] = [
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


/** Replaces known secret formats in `value`; returns the text and how many were replaced. */
export function redactSecrets(value: string): { text: string; count: number } {
	let count = 0;
	let text = value;
	for (const [kind, pattern] of SECRET_PATTERNS) {
		text = text.replace(new RegExp(pattern.source, pattern.flags), () => {
			count++;
			return `[redacted:${kind}]`;
		});
	}
	return { text, count };
}
