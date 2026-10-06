/**
 * #29 (R9): an AI agent session. Since #309 it works in the repo itself, on its own branches,
 * through the Git endpoint's branch rules; sessions started before that work in a fork.
 */
export const AGENT_HARNESSES = ["claude-code", "codex", "cursor", "opencode", "other"] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

export interface AgentSession {
	id: string;
	/** owner/slug of the repo the session started from. */
	repo: string;
	/** owner/slug where it pushes: the repo itself, or (older sessions) its fork. */
	fork: string;
	/** #309: works in the repo itself (not a fork). */
	inRepo: boolean;
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
/** Session sign-ins (and older sessions' write tokens) last 8 hours and can be renewed. */
export const SESSION_TOKEN_TTL = 28_800;
