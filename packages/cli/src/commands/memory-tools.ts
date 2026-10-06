import { ApiError, call as apiCall } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { createRedactor, envValues } from "../redact.ts";
import { redactionSettings } from "./checkpoint.ts";
import { storedSessions } from "./session.ts";

/**
 * #195: the repo's memory (#194) as MCP tools: notes agents and people keep about the repo
 * (conventions, decisions, gotchas). Text is redacted here before it leaves the machine; the
 * server redacts again. Same tools in every harness.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const tags = { type: "array", items: { type: "string" }, description: "Short lowercase tags, e.g. testing, deploy, style." };

export const MEMORY_TOOLS = [
	{
		name: "memory_recall",
		description:
			"Search this repo's memory on appmarket.org: notes about its conventions, decisions and gotchas, kept by its people and agents. Call it before starting work, and when unsure how something is done here. Without a query, pinned notes come first.",
		inputSchema: obj({ query: str("Words to look for."), tag: str("Only notes with this tag.") }),
	},
	{
		name: "memory_remember",
		description: "Add a note to this repo's memory: something a future session should know (how to run the tests, a decision and why, a trap). One fact per note, at most 1000 characters. Never secrets.",
		inputSchema: obj({ text: str("The note."), tags, pinned: { type: "boolean", description: "Pin it so every session reads it first (for the most important notes)." } }, ["text"]),
	},
	{
		name: "memory_update",
		description: "Change a note (its id from memory_recall) when it is out of date. Its history is kept.",
		inputSchema: obj({ id: str("The note id."), text: str("The new text."), tags, pinned: { type: "boolean" } }, ["id"]),
	},
	{
		name: "memory_forget",
		description: "Delete a note (its id from memory_recall) that is wrong or no longer true. Its history is kept.",
		inputSchema: obj({ id: str("The note id.") }, ["id"]),
	},
] as const;

export const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set(MEMORY_TOOLS.map((t) => t.name));

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

interface Note {
	id: string;
	text: string;
	tags: string[];
	pinned: boolean;
	createdBy: string;
	updatedAt: string;
}

export interface MemoryDeps {
	call: typeof apiCall;
	token: (api: string) => Promise<string | null>;
}
const defaults: MemoryDeps = { call: apiCall, token: async (api) => (await loadCredentials(api))?.token ?? null };

export const describeNotes = (notes: Note[], total: number): string =>
	notes.length
		? `${notes.map((n) => `- [${n.id}]${n.pinned ? " (pinned)" : ""}${n.tags.length ? ` #${n.tags.join(" #")}` : ""}\n  ${n.text.replace(/\n/g, "\n  ")}`).join("\n")}${total > notes.length ? `\n(${total - notes.length} more; narrow the query)` : ""}`
		: "No notes match.";

function problem(error: unknown): string {
	if (error instanceof ApiError) {
		const body = (error.body ?? {}) as { error?: string; message?: string };
		if (error.status === 401) return "Not signed in to appmarket.org: run `appmarket login`.";
		if (error.status === 403 && body.error === "insufficient_scope") return "This sign-in cannot use repo memory: run `appmarket login` again.";
		if (error.status === 404) return "No such note, or no access to this repo's memory.";
		if (error.status === 429) return "Too many memory changes; try again in a minute.";
		return body.message ?? body.error ?? `HTTP ${error.status}`;
	}
	return `appmarket.org could not be reached (${error instanceof Error ? error.message : String(error)}).`;
}

export async function callMemoryTool(name: string, args: Record<string, unknown>, cwd = process.cwd(), deps: MemoryDeps = defaults): Promise<Result> {
	const root = repoRoot(cwd);
	const repo = root ? gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root }) : "";
	if (!root || !repo) return text("This folder is not an appmarket.org repo (run `appmarket init`).", true);
	const session = gitOr(["config", "--get", "appmarket.session"], "", { cwd: root }) || null;
	const stored = session ? storedSessions().find((s) => s.id === session) : undefined;
	const api = stored?.api ?? gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
	const token = await deps.token(api);
	if (!token) return text("Not signed in to appmarket.org: run `appmarket login`.", true);
	const settings = redactionSettings(root);
	const redact = (value: unknown) => (typeof value === "string" ? createRedactor({ envValues: envValues(root), extra: settings.extra }).text(value) : undefined);
	const base = `/api/repos/${repo}/memory`;
	const attribution = { source: "mcp", ...(session ? { session } : {}) };
	const id = typeof args.id === "string" && /^[0-9a-f-]{36}$/.test(args.id) ? args.id : null;
	try {
		switch (name) {
			case "memory_recall": {
				const query = new URLSearchParams();
				if (typeof args.query === "string" && args.query.trim()) query.set("q", args.query.trim());
				if (typeof args.tag === "string" && args.tag.trim()) query.set("tag", args.tag.trim());
				query.set("limit", "20");
				const r = await deps.call<{ notes: Note[]; total: number }>(api, `${base}?${query}`, { token });
				return text(describeNotes(r.notes, r.total));
			}
			case "memory_remember": {
				if (typeof args.text !== "string" || !args.text.trim()) return text("text is required.", true);
				const note = await deps.call<Note>(api, base, { method: "POST", token, body: { text: redact(args.text), tags: args.tags, pinned: args.pinned === true, ...attribution } });
				return text(`Remembered [${note.id}]${note.pinned ? " (pinned)" : ""}.`);
			}
			case "memory_update": {
				if (!id) return text("id is required (from memory_recall).", true);
				const body: Record<string, unknown> = { ...attribution };
				if (args.text !== undefined) body.text = redact(args.text);
				if (args.tags !== undefined) body.tags = args.tags;
				if (args.pinned !== undefined) body.pinned = args.pinned;
				await deps.call(api, `${base}/${id}`, { method: "PATCH", token, body });
				return text(`Updated [${id}].`);
			}
			case "memory_forget": {
				if (!id) return text("id is required (from memory_recall).", true);
				await deps.call(api, `${base}/${id}?source=mcp`, { method: "DELETE", token });
				return text(`Forgot [${id}].`);
			}
			default:
				return text(`Unknown tool: ${name}`, true);
		}
	} catch (error) {
		return text(problem(error), true);
	}
}
