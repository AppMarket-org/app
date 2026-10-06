import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, call as apiCall } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { createRedactor, envValues } from "../redact.ts";
import { redactionSettings } from "./checkpoint.ts";
import { storedSessions } from "./session.ts";

/**
 * #196: the repo's memory at the start of an agent session (the SessionStart hook adds it to the
 * agent's context, like CLAUDE.md), and `appmarket memory` to list, add, remove and export notes.
 */
interface Note {
	id: string;
	text: string;
	tags: string[];
	pinned: boolean;
}

export interface MemoryDeps {
	call: typeof apiCall;
	token: (api: string) => Promise<string | null>;
}
const defaults: MemoryDeps = { call: apiCall, token: async (api) => (await loadCredentials(api))?.token ?? null };

/** The repo, server and session of a checkout, or null outside an appmarket repo. */
function where(cwd: string): { root: string; repo: string; api: string; session: string | null } | null {
	const root = repoRoot(cwd);
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) return null;
	const session = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root }) || null;
	const api = (session && storedSessions().find((s) => s.id === session)?.api) || gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	return { root, repo, api, session };
}

/** Notes as context for an agent: pinned first, then the most recent, within `budget` characters. */
export function contextFrom(notes: Note[], repo: string, budget = 4000): string {
	if (!notes.length) return "";
	const head = `# Repo memory (${repo} on appmarket.org)\nNotes this repo's people and agents keep. Search more with memory_recall; add what the next session should know with memory_remember.\n`;
	const lines: string[] = [];
	let used = head.length;
	for (const n of notes) {
		const line = `- ${n.pinned ? "(pinned) " : ""}${n.text.replace(/\s*\n\s*/g, " ")}${n.tags.length ? ` [${n.tags.join(", ")}]` : ""}`;
		if (used + line.length + 1 > budget) break;
		lines.push(line);
		used += line.length + 1;
	}
	const more = notes.length - lines.length;
	return `${head}${lines.join("\n")}${more > 0 ? `\n(${more} more notes: memory_recall)` : ""}\n`;
}

/** For the SessionStart hook: the context, or "" when signed out, offline or slow (2 s), never an error. */
export async function sessionStartContext(cwd: string, deps: MemoryDeps = defaults): Promise<string> {
	try {
		const at = where(cwd);
		if (!at) return "";
		const token = await deps.token(at.api);
		if (!token) return "";
		const r = await deps.call<{ notes: Note[] }>(at.api, `/api/repos/${at.repo}/memory?limit=50`, { token, timeoutMs: 2000 });
		return contextFrom(r.notes, at.repo);
	} catch {
		return "";
	}
}

export const MEMORY_MARK_START = "<!-- appmarket:memory -->";
export const MEMORY_MARK_END = "<!-- /appmarket:memory -->";

/** AGENTS.md with the memory section replaced (or added at the end). */
export function withMemorySection(current: string, notes: Note[], repo: string): string {
	const section = `${MEMORY_MARK_START}\n## Repo memory\n\nFrom ${repo} on appmarket.org (\`appmarket memory export\` refreshes this section).\n\n${notes.map((n) => `- ${n.text.replace(/\s*\n\s*/g, " ")}`).join("\n") || "- (no notes yet)"}\n${MEMORY_MARK_END}`;
	const start = current.indexOf(MEMORY_MARK_START);
	const end = current.indexOf(MEMORY_MARK_END);
	if (start !== -1 && end > start) return `${current.slice(0, start)}${section}${current.slice(end + MEMORY_MARK_END.length)}`;
	return `${current.replace(/\s*$/, "")}${current.trim() ? "\n\n" : ""}${section}\n`;
}

const explain = (error: unknown) =>
	error instanceof ApiError
		? error.status === 401
			? "Not signed in: run `appmarket login`."
			: error.status === 403
				? "This sign-in cannot use repo memory: run `appmarket login` again."
				: error.status === 404
					? "No such note, or no access to this repo's memory."
					: ((error.body as { message?: string } | null)?.message ?? `HTTP ${error.status}`)
		: `appmarket.org could not be reached (${error instanceof Error ? error.message : String(error)}).`;

/** `appmarket memory list [query] [--tag t] | add <text> [--tags a,b] [--pin] | remove <id> | export`. */
export async function memory(sub: string | undefined, args: string[], flags: { tag?: string; tags?: string; pin?: boolean }, cwd = process.cwd(), deps: MemoryDeps = defaults): Promise<number> {
	const at = where(cwd);
	if (!at) return (console.error("This folder is not an appmarket.org repo (run `appmarket init`)."), 1);
	const token = await deps.token(at.api);
	if (!token) return (console.error("Not signed in: run `appmarket login`."), 1);
	const base = `/api/repos/${at.repo}/memory`;
	try {
		switch (sub) {
			case "list": {
				const q = new URLSearchParams({ limit: "100" });
				if (args.join(" ").trim()) q.set("q", args.join(" ").trim());
				if (flags.tag) q.set("tag", flags.tag);
				const r = await deps.call<{ notes: Note[]; total: number }>(at.api, `${base}?${q}`, { token });
				if (!r.notes.length) console.log("No notes.");
				for (const n of r.notes) console.log(`${n.id}  ${n.pinned ? "📌 " : ""}${n.text.replace(/\s*\n\s*/g, " ")}${n.tags.length ? `  #${n.tags.join(" #")}` : ""}`);
				return 0;
			}
			case "add": {
				const text = args.join(" ").trim();
				if (!text) return (console.error('Usage: appmarket memory add "<note>" [--tags a,b] [--pin]'), 1);
				const redacted = createRedactor({ envValues: envValues(at.root), extra: redactionSettings(at.root).extra }).text(text);
				const note = await deps.call<Note>(at.api, base, {
					method: "POST",
					token,
					body: { text: redacted, tags: flags.tags ? flags.tags.split(",").map((t) => t.trim()) : [], pinned: !!flags.pin, source: "cli", ...(at.session ? { session: at.session } : {}) },
				});
				console.log(`Added ${note.id}${note.pinned ? " (pinned)" : ""}.`);
				return 0;
			}
			case "remove": {
				const id = args[0];
				if (!id || !/^[0-9a-f-]{36}$/.test(id)) return (console.error("Usage: appmarket memory remove <id> (ids from `appmarket memory list`)"), 1);
				await deps.call(at.api, `${base}/${id}?source=cli`, { method: "DELETE", token });
				console.log(`Removed ${id}.`);
				return 0;
			}
			case "export": {
				const r = await deps.call<{ notes: Note[] }>(at.api, `${base}?limit=500`, { token });
				const file = join(at.root, "AGENTS.md");
				writeFileSync(file, withMemorySection(existsSync(file) ? readFileSync(file, "utf8") : "", r.notes, at.repo));
				console.log(`Wrote ${r.notes.length} note(s) to AGENTS.md (between ${MEMORY_MARK_START} markers).`);
				return 0;
			}
			default:
				console.error("Usage: appmarket memory list [query] [--tag t] | add <text> [--tags a,b] [--pin] | remove <id> | export");
				return 1;
		}
	} catch (error) {
		console.error(explain(error));
		return 1;
	}
}
