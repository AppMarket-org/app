/** #194 (Agent memory): a repo's notes for agents and people. */
export const MEMORY_LIMITS = {
	/** Characters per note. */
	text: 1000,
	tagsPerNote: 10,
	/** Notes per repo (deleted ones do not count). */
	notesPerRepo: 500,
} as const;

/** Where a note came from: a harness, the CLI or the website. */
export const MEMORY_SOURCES = ["web", "cli", "claude-code", "codex", "cursor", "opencode", "mcp", "other"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface MemoryNote {
	id: string;
	text: string;
	tags: string[];
	pinned: boolean;
	createdBy: string;
	source: MemorySource;
	sessionId: string | null;
	redactions: number;
	createdAt: string;
	updatedAt: string;
}

export interface MemoryChange {
	version: number;
	action: "create" | "update" | "delete";
	text: string;
	tags: string[];
	pinned: boolean;
	changedBy: string;
	source: MemorySource;
	sessionId: string | null;
	changedAt: string;
}

export interface MemoryInput {
	text?: unknown;
	tags?: unknown;
	pinned?: unknown;
	source?: unknown;
	session?: unknown;
}

/** Tags: lowercase words of letters, digits, '-', '.', at most 32 characters each. */
export function cleanMemoryTags(tags: unknown): string[] | null {
	if (tags === undefined) return [];
	if (!Array.isArray(tags)) return null;
	const out = [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase().replace(/^#/, "")))].filter((t) => /^[a-z0-9][a-z0-9.-]{0,31}$/.test(t));
	return out.length > MEMORY_LIMITS.tagsPerNote ? null : out;
}

/** Validates a create (all fields) or an update (only the given ones); returns a problem or the values. */
export function parseMemoryInput(input: MemoryInput, partial: boolean): { error: string } | { text?: string; tags?: string[]; pinned?: boolean; source: MemorySource; sessionId: string | null } {
	const out: { text?: string; tags?: string[]; pinned?: boolean; source: MemorySource; sessionId: string | null } = {
		source: MEMORY_SOURCES.includes(input.source as MemorySource) ? (input.source as MemorySource) : "web",
		sessionId: typeof input.session === "string" && /^[0-9a-f-]{36}$/.test(input.session) ? input.session : null,
	};
	if (input.text !== undefined || !partial) {
		if (typeof input.text !== "string" || !input.text.trim()) return { error: "text is required." };
		const text = input.text.trim().replace(/\r\n/g, "\n");
		if (text.length > MEMORY_LIMITS.text) return { error: `A note is at most ${MEMORY_LIMITS.text} characters.` };
		out.text = text;
	}
	if (input.tags !== undefined || !partial) {
		const tags = cleanMemoryTags(input.tags);
		if (!tags) return { error: `At most ${MEMORY_LIMITS.tagsPerNote} tags.` };
		out.tags = tags;
	}
	if (input.pinned !== undefined) {
		if (typeof input.pinned !== "boolean") return { error: "pinned is true or false." };
		out.pinned = input.pinned;
	}
	if (partial && out.text === undefined && out.tags === undefined && out.pinned === undefined) return { error: "Nothing to change." };
	return out;
}
