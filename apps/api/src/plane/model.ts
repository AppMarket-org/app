/**
 * #80/#236: the collaboration plane's rules, pure and unit-tested. Agents (one per agent session,
 * #29) claim tasks and lease the paths they will touch; Git isolates their work on branches, the
 * leases keep two agents from editing the same files at once.
 */
export type TaskStatus = "open" | "claimed" | "done" | "failed";

export interface PlaneTask {
	id: string;
	title: string;
	description: string;
	/** Capabilities an agent must declare to claim it (e.g. "typescript", "frontend"). */
	capabilities: string[];
	status: TaskStatus;
	claimedBy: string | null;
	branch: string | null;
	note: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PlaneAgent {
	/** The agent session id (#29). */
	id: string;
	name: string;
	vendor: string;
	capabilities: string[];
	lastSeen: string;
}

export interface PlaneLease {
	agentId: string;
	taskId: string | null;
	/** A file or a directory ("src/auth/" leases everything under it). */
	path: string;
	expiresAt: number;
}

export const MAX_LEASE_SECONDS = 4 * 3600;
export const DEFAULT_LEASE_SECONDS = 3600;

/** Normalizes a lease path: no leading ./ or /, no .., directories end with /. */
export function normalizePath(path: string): string | null {
	const p = path.trim().replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
	if (!p || p.length > 512 || p.split("/").some((s) => s === "..") || /[\0*?[\]]/.test(p)) return null;
	return p;
}

/** Two lease paths overlap when one is the other or contains it ("src/" contains "src/a.ts"; "" is the whole repo). */
export function pathsOverlap(a: string, b: string): boolean {
	const dir = (p: string) => (p.endsWith("/") ? p : `${p}/`);
	return a === b || b.startsWith(dir(a)) || a.startsWith(dir(b));
}

/** Active leases held by other agents that overlap any of the paths. */
export function leaseConflicts(leases: PlaneLease[], agentId: string, paths: string[], now: number): PlaneLease[] {
	return leases.filter((l) => l.expiresAt > now && l.agentId !== agentId && paths.some((p) => pathsOverlap(l.path, p)));
}

/** Why an agent cannot claim a task, or null when it can. */
export function claimProblem(task: PlaneTask | undefined, agent: PlaneAgent | undefined): string | null {
	if (!task) return "No such task.";
	if (!agent) return "Register the agent first.";
	if (task.status !== "open") return `The task is ${task.status}.`;
	const missing = task.capabilities.filter((c) => !agent.capabilities.includes(c));
	return missing.length ? `The task needs capabilities this agent did not declare: ${missing.join(", ")}.` : null;
}

export const cleanTags = (tags: unknown): string[] =>
	Array.isArray(tags) ? [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter((t) => /^[a-z0-9][a-z0-9.+#-]{0,39}$/.test(t)))].slice(0, 20) : [];
