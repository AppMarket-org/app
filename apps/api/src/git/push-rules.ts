/**
 * #308: branch rules for agent sessions, checked by the Git endpoint before a push reaches
 * Artifacts. A push request starts with its commands ("<old> <new> <ref>", the first with the
 * client's capabilities after a NUL), then a flush, then the pack. Pure, for tests.
 */
const dec = new TextDecoder();
const enc = new TextEncoder();
export const ZERO = "0".repeat(40);

export interface PushCommand {
	old: string;
	new: string;
	ref: string;
}

export interface ParsedPush {
	commands: PushCommand[];
	capabilities: string[];
}

/** Reads the commands section (up to the first flush) from the start of a push request, or null if it is not complete. */
export function parsePushCommands(bytes: Uint8Array): (ParsedPush & { end: number }) | null {
	const commands: PushCommand[] = [];
	let capabilities: string[] = [];
	let i = 0;
	while (i + 4 <= bytes.length) {
		const len = Number.parseInt(dec.decode(bytes.subarray(i, i + 4)), 16);
		if (Number.isNaN(len)) return null;
		if (len === 0) return { commands, capabilities, end: i + 4 };
		if (len < 4 || i + len > bytes.length) return null;
		let line = dec.decode(bytes.subarray(i + 4, i + len)).replace(/\n$/, "");
		i += len;
		const nul = line.indexOf("\0");
		if (nul !== -1) {
			capabilities = line.slice(nul + 1).split(" ").filter(Boolean);
			line = line.slice(0, nul);
		}
		if (line.startsWith("shallow ")) continue;
		const [old, next, ref] = line.split(" ");
		if (!old || !next || !ref) return null;
		commands.push({ old, new: next, ref });
	}
	return null;
}

export interface PushRules {
	/** The default branch and any the owner protected (names, or patterns ending in *). */
	protectedBranches: string[];
	/** Branches this session created (it may delete those). */
	created: ReadonlySet<string>;
}

export const isProtected = (branch: string, patterns: string[]) => patterns.some((p) => (p.endsWith("*") ? branch.startsWith(p.slice(0, -1)) : branch === p));

/** Why each refused command is refused (empty: the push may go ahead). */
export function refusals(commands: PushCommand[], rules: PushRules): { ref: string; reason: string }[] {
	const out: { ref: string; reason: string }[] = [];
	for (const c of commands) {
		if (!c.ref.startsWith("refs/heads/")) {
			out.push({ ref: c.ref, reason: c.ref.startsWith("refs/tags/") ? "agent sessions cannot push tags" : "agent sessions push branches only" });
			continue;
		}
		const branch = c.ref.slice("refs/heads/".length);
		if (isProtected(branch, rules.protectedBranches)) out.push({ ref: c.ref, reason: "protected branch; push your own branch and open a pull request" });
		else if (c.new === ZERO && !rules.created.has(branch)) out.push({ ref: c.ref, reason: "agent sessions delete only branches they created" });
	}
	return out;
}

const pkt = (s: string) => enc.encode((s.length + 4).toString(16).padStart(4, "0") + s);

/**
 * The answer to a refused push, as Git expects it: the report-status (every ref refused, nothing
 * was applied) and, with side-band, "remote:" lines saying why. Git prints
 * "! [remote rejected] <ref> (<reason>)".
 */
export function refusedPush(parsed: ParsedPush, problems: { ref: string; reason: string }[]): Uint8Array {
	const why = new Map(problems.map((p) => [p.ref, p.reason]));
	const report = [pkt("unpack ok\n"), ...parsed.commands.map((c) => pkt(`ng ${c.ref} ${why.get(c.ref) ?? "refused with the rest of the push"}\n`)), enc.encode("0000")];
	const sideband = parsed.capabilities.includes("side-band-64k") || parsed.capabilities.includes("side-band");
	if (!parsed.capabilities.includes("report-status") && !parsed.capabilities.includes("report-status-v2") && !sideband) return enc.encode("0000");
	if (!sideband) return concat(report);
	const channel = (n: number, data: Uint8Array) => {
		const out = new Uint8Array(5 + data.length);
		out.set(enc.encode((5 + data.length).toString(16).padStart(4, "0")), 0);
		out[4] = n;
		out.set(data, 5);
		return out;
	};
	const messages = ["appmarket.org: this push was refused for an agent session.", ...problems.map((p) => `  ${p.ref}: ${p.reason}`)].map((l) => channel(2, enc.encode(`${l}\n`)));
	return concat([...messages, channel(1, concat(report)), enc.encode("0000")]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
