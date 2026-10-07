/**
 * Checkpoints PRD: one record per commit an agent (or a person) makes, keyed by (repo, commit).
 * The same JSON is the git note under refs/notes/appmarket, the stored record and the API response.
 */
export const CHECKPOINT_SCHEMA = "appmarket.checkpoint/1";

export const HARNESSES = ["claude-code", "codex", "opencode", "cursor", "mcp", "none"] as const;
export type Harness = (typeof HARNESSES)[number];

export const EFFORT_LEVELS = ["low", "medium", "high", "max", "unknown"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function effortLevelLabel(level: EffortLevel): string {
	return { low: "Low effort", medium: "Medium effort", high: "High effort", max: "Max effort", unknown: "" }[level];
}

export const CHECKPOINT_VISIBILITIES = ["private", "listing", "public"] as const;
export type CheckpointVisibility = (typeof CHECKPOINT_VISIBILITIES)[number];

/** pending: the commit is not on appmarket.org yet; attached: it is; missing: a placeholder for a pushed commit with no checkpoint. */
export const CHECKPOINT_STATES = ["pending", "attached", "missing"] as const;
export type CheckpointState = (typeof CHECKPOINT_STATES)[number];

/** harness: captured by a harness hook or plugin; agent-reported: sent by the agent itself (MCP fallback). */
export type CheckpointSource = "harness" | "agent-reported";

/** Size caps (PRD "Server-side controls"). */
export const CHECKPOINT_LIMITS = {
	inlineBytes: 256 * 1024,
	assistantSummaryChars: 2048,
	tools: 200,
	prompts: 500,
	files: 2000,
} as const;

export interface CheckpointRecord {
	schema: typeof CHECKPOINT_SCHEMA;
	commit: string;
	parents: string[];
	branch: string;
	author: { name: string; email: string };
	harness: Harness;
	harness_version: string;
	session_id: string;
	model: string;
	effort: { raw: string; level: EffortLevel };
	effort_metrics: { turns: number; wall_clock_s: number; tool_calls: number; retries: number; reasoning_tokens: number | null };
	prompts: { ts: string; text: string }[];
	assistant_summary: string;
	tools: { name: string; args_summary: string; outcome: "ok" | "error"; ts: string }[];
	usage: {
		/** All input, including cache reads and writes. */
		input_tokens: number | null;
		output_tokens: number | null;
		cost_usd: number | null;
		cache_read_tokens?: number | null;
		cache_write_tokens?: number | null;
		/** Set when appmarket.org computed cost_usd: the price table version used (#127). */
		cost_priced?: string;
	};
	files: { path: string; added: number; removed: number }[];
	redactions: number;
	source: CheckpointSource;
	created_at: string;
	/** Set when a rebase or amend copied this record from another commit. */
	rewritten_from?: string;
	truncated?: boolean;
}

/** A stored checkpoint as the API returns it. Prompt fields are omitted for viewers who may only see metadata. */
export interface Checkpoint extends Omit<CheckpointRecord, "prompts" | "assistant_summary" | "tools" | "usage"> {
	repo: string;
	state: CheckpointState;
	/** #129: the full record is stored encrypted (fetch …/transcript); its size in bytes. */
	transcript_bytes?: number;
	/** #128: secrets appmarket.org redacted that the uploading CLI missed. */
	server_redactions?: number;
	visibility: CheckpointVisibility;
	device: string | null;
	received_at: string;
	prompts?: CheckpointRecord["prompts"];
	assistant_summary?: string;
	tools?: CheckpointRecord["tools"];
	usage?: CheckpointRecord["usage"];
}

export interface CheckpointSummary {
	total: number;
	/** Commits per harness ("none" = manual). */
	harnesses: Partial<Record<Harness, number>>;
	/** #137: every commit with a checkpoint (any visibility), and those with published prompts. */
	commits?: number;
	withPublishedPrompts?: number;
}

/** #135: a moderator viewed private checkpoints while handling a report. */
export interface CheckpointAccess {
	viewedAt: string;
	/** The report's reason (spam, malware, …). */
	reason: string;
	privateCount: number;
}

export interface CheckpointPage {
	items: Checkpoint[];
	/** On the first page only: counts over every checkpoint the viewer may see. */
	summary?: CheckpointSummary;
	/** Pass as `before` to get the next (older) page; null at the end. */
	next: string | null;
}

/**
 * A commit as a repo's commit list and a profile's activity show it, with the prompts behind it
 * when the viewer may see its checkpoint.
 */
export interface CommitEntry {
	sha: string;
	/** First line of the message. */
	title: string;
	author: { name: string };
	/** ISO time the commit was authored. */
	date: string;
	checkpoint: { harness: Harness; model: string; visibility: CheckpointVisibility; prompts: string[]; promptCount: number } | null;
}
