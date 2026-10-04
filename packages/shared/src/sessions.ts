/** #29 (R9): an AI agent session that works in its own fork of a repo. */
export const AGENT_HARNESSES = ["claude-code", "codex", "cursor", "opencode", "other"] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

export interface AgentSession {
	id: string;
	/** owner/slug of the repo the session started from. */
	repo: string;
	/** owner/slug of the session's fork. */
	fork: string;
	harness: AgentHarness;
	status: "active" | "ended" | "discarded";
	startedBy: string;
	tokenExpiresAt: string;
	createdAt: string;
	endedAt: string | null;
}

/** Returned once when a session starts or its token is renewed; the token is never stored. */
export interface AgentSessionToken {
	session: AgentSession;
	remote: string;
	token: string;
	expiresAt: string;
}

/** At most this many active sessions per repo. */
export const MAX_ACTIVE_SESSIONS = 10;
/** Write tokens for sessions last 8 hours (the write-token maximum) and can be renewed. */
export const SESSION_TOKEN_TTL = 28_800;
