import { redactSecrets } from "@appmarket/shared";

const MAX_LINES = 300;
const MAX_CHARS = 48_000;

/** #40: the tail of a step's output for the buyer, with secrets redacted and ANSI codes stripped. */
export function logSection(title: string, logs: { stdout?: unknown; stderr?: unknown } | undefined): string {
	const text = [logs?.stdout, logs?.stderr].filter((s): s is string => typeof s === "string" && s.length > 0).join("\n");
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes
	const clean = redactSecrets(text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")).text;
	const lines = clean.split("\n");
	const tail = lines.length > MAX_LINES ? [`… ${lines.length - MAX_LINES} earlier lines`, ...lines.slice(-MAX_LINES)] : lines;
	return `== ${title} ==\n${tail.join("\n").slice(-MAX_CHARS / 2)}\n`;
}

export function joinLogs(previous: string | null, section: string): string {
	return `${previous ?? ""}${section}`.slice(-MAX_CHARS);
}
