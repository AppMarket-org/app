/**
 * #197: notes a checkpoint suggests for the repo's memory, by rules anyone can follow (nothing is
 * saved until a person accepts one). Pure, for tests.
 *
 * - gotcha: a command failed, then a different command of the same kind worked;
 * - command: a test, build, lint, typecheck or migrate command that worked;
 * - convention: a sentence in the prompts that says always, never, don't or prefer.
 */
export interface Suggestion {
	kind: "gotcha" | "command" | "convention";
	text: string;
	tags: string[];
}

interface Record {
	prompts: { text: string }[];
	tools: { name: string; args_summary: string; outcome: "ok" | "error" }[];
}

const KINDS: [RegExp, string][] = [
	[/\b(test|vitest|jest|pytest|mocha|node --test|go test|cargo test)\b/, "testing"],
	[/\b(build|tsc|compile|cargo build|go build)\b/, "build"],
	[/\b(lint|eslint|biome|ruff|clippy|prettier)\b/, "lint"],
	[/\b(typecheck|type-check|tsc --noEmit|mypy|pyright)\b/, "types"],
	[/\b(migrate|migration|db:migrate|prisma migrate|drizzle-kit)\b/, "database"],
];

const kindOf = (command: string) => KINDS.find(([re]) => re.test(command))?.[1] ?? null;
const shell = (t: Record["tools"][number]) => /^(bash|shell|exec_command|run_terminal_cmd|local_shell)$/i.test(t.name) && t.args_summary.trim().length > 0;
const clean = (command: string) => command.trim().replace(/\s+/g, " ").replace(/^cd [^&;]+(&&|;)\s*/, "").slice(0, 200);
const known = (text: string, existing: string[]) => {
	const needle = text.toLowerCase();
	return existing.some((e) => e.toLowerCase().includes(needle) || needle.includes(e.toLowerCase()));
};

export function suggestNotes(record: Record, existing: string[], max = 3): Suggestion[] {
	const out: Suggestion[] = [];
	const add = (s: Suggestion, key: string) => {
		if (out.length < max && !out.some((o) => o.text === s.text) && !known(key, existing)) out.push(s);
	};
	const commands = record.tools.filter(shell).map((t) => ({ command: clean(t.args_summary), ok: t.outcome === "ok", kind: kindOf(t.args_summary) }));
	// A failure followed (later in the session) by a different command of the same kind that worked.
	for (const [i, c] of commands.entries()) {
		if (c.ok || !c.kind) continue;
		const fix = commands.slice(i + 1).find((d) => d.ok && d.kind === c.kind && d.command !== c.command);
		if (fix) add({ kind: "gotcha", text: `\`${c.command}\` fails in this repo; use \`${fix.command}\`.`, tags: [c.kind] }, fix.command);
	}
	for (const c of commands) {
		if (c.ok && c.kind && !out.some((o) => o.text.includes(c.command))) add({ kind: "command", text: `${c.kind === "testing" ? "Run the tests" : c.kind === "build" ? "Build" : c.kind === "lint" ? "Lint" : c.kind === "types" ? "Check types" : "Run migrations"} with \`${c.command}\`.`, tags: [c.kind] }, c.command);
	}
	for (const p of record.prompts) {
		for (const sentence of p.text.split(/(?<=[.!?])\s+|\n+/)) {
			const s = sentence.trim();
			if (s.length >= 15 && s.length <= 300 && /\b(always|never|don't|do not|must not|prefer)\b/i.test(s)) add({ kind: "convention", text: s.replace(/^[-*]\s*/, ""), tags: ["convention"] }, s);
		}
	}
	return out;
}
