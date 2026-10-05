import { DurableObject } from "cloudflare:workers";
import {
	claimProblem,
	DEFAULT_LEASE_SECONDS,
	leaseConflicts,
	MAX_LEASE_SECONDS,
	type PlaneAgent,
	type PlaneLease,
	type PlaneTask,
	type TaskStatus,
} from "./model.ts";

export interface PlaneState {
	tasks: PlaneTask[];
	agents: PlaneAgent[];
	leases: PlaneLease[];
}

export type PlaneResult<T = PlaneState> = { ok: true; value: T } | { ok: false; error: string; conflicts?: PlaneLease[] };

/** Done and failed tasks kept for the board; older ones are dropped. */
const KEEP_FINISHED = 100;

/**
 * #80/#236: one coordinator per repo (named by repo id). Holds the task board, the agents taking
 * part (one per agent session, #29) and their path leases; every change is pushed to the
 * dashboards watching over hibernatable WebSockets. Requests run one at a time, so a claim or
 * lease either wins or sees the other agent's.
 */
export class RepoPlane extends DurableObject {
	private get sql() {
		return this.ctx.storage.sql;
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.sql.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, capabilities TEXT NOT NULL,
				status TEXT NOT NULL, claimed_by TEXT, branch TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
			this.sql.exec(`CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor TEXT NOT NULL, capabilities TEXT NOT NULL, last_seen TEXT NOT NULL)`);
			this.sql.exec(`CREATE TABLE IF NOT EXISTS leases (agent_id TEXT NOT NULL, task_id TEXT, path TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (agent_id, path))`);
		});
	}

	state(): PlaneState {
		const now = Date.now();
		this.sql.exec("DELETE FROM leases WHERE expires_at <= ?", now);
		return {
			tasks: this.sql.exec<Record<string, string | null>>("SELECT * FROM tasks ORDER BY created_at DESC").toArray().map(toTask),
			agents: this.sql.exec<Record<string, string>>("SELECT * FROM agents ORDER BY last_seen DESC").toArray().map((r) => ({
				id: r.id!,
				name: r.name!,
				vendor: r.vendor!,
				capabilities: JSON.parse(r.capabilities!) as string[],
				lastSeen: r.last_seen!,
			})),
			leases: this.leases(),
		};
	}

	createTask(input: { id: string; title: string; description: string; capabilities: string[] }): PlaneResult {
		const now = new Date().toISOString();
		this.sql.exec(
			"INSERT INTO tasks (id, title, description, capabilities, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)",
			input.id, input.title, input.description, JSON.stringify(input.capabilities), now, now,
		);
		return this.changed();
	}

	/** Removes a task (the owner cancels it); its leases are released. */
	deleteTask(id: string): PlaneResult {
		this.sql.exec("DELETE FROM leases WHERE task_id = ?", id);
		this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
		return this.changed();
	}

	registerAgent(agent: Omit<PlaneAgent, "lastSeen">): PlaneResult {
		this.sql.exec(
			"INSERT INTO agents (id, name, vendor, capabilities, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, vendor = excluded.vendor, capabilities = excluded.capabilities, last_seen = excluded.last_seen",
			agent.id, agent.name, agent.vendor, JSON.stringify(agent.capabilities), new Date().toISOString(),
		);
		return this.changed();
	}

	/** The agent's session ended: it leaves, its leases go and its claimed tasks reopen. */
	removeAgent(agentId: string): PlaneResult {
		this.sql.exec("DELETE FROM leases WHERE agent_id = ?", agentId);
		this.sql.exec("UPDATE tasks SET status = 'open', claimed_by = NULL, updated_at = ? WHERE claimed_by = ? AND status = 'claimed'", new Date().toISOString(), agentId);
		this.sql.exec("DELETE FROM agents WHERE id = ?", agentId);
		return this.changed();
	}

	claim(taskId: string, agentId: string): PlaneResult {
		const state = this.state();
		const problem = claimProblem(state.tasks.find((t) => t.id === taskId), state.agents.find((a) => a.id === agentId));
		if (problem) return { ok: false, error: problem };
		this.sql.exec("UPDATE tasks SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ?", agentId, new Date().toISOString(), taskId);
		this.touch(agentId);
		return this.changed();
	}

	/** Leases paths for the agent, all or none: any overlap with another agent's lease refuses the lot. */
	lease(agentId: string, paths: string[], taskId: string | null, seconds = DEFAULT_LEASE_SECONDS): PlaneResult {
		if (!this.agent(agentId)) return { ok: false, error: "Register the agent first." };
		const now = Date.now();
		const conflicts = leaseConflicts(this.leases(), agentId, paths, now);
		if (conflicts.length) return { ok: false, error: "Another agent holds a lease on these paths.", conflicts };
		const expires = now + Math.min(Math.max(seconds, 60), MAX_LEASE_SECONDS) * 1000;
		for (const path of paths) {
			this.sql.exec(
				"INSERT INTO leases (agent_id, task_id, path, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, path) DO UPDATE SET task_id = excluded.task_id, expires_at = excluded.expires_at",
				agentId, taskId, path, expires,
			);
		}
		this.touch(agentId);
		void this.ctx.storage.setAlarm(Math.min(expires, this.nextExpiry() ?? expires));
		return this.changed();
	}

	/** Releases the given paths, or all the agent's leases. */
	release(agentId: string, paths?: string[]): PlaneResult {
		if (paths?.length) for (const p of paths) this.sql.exec("DELETE FROM leases WHERE agent_id = ? AND path = ?", agentId, p);
		else this.sql.exec("DELETE FROM leases WHERE agent_id = ?", agentId);
		return this.changed();
	}

	/** The claiming agent reports the task done (naming the branch to merge, #238) or failed; its task leases are released. */
	finish(taskId: string, agentId: string, status: Extract<TaskStatus, "done" | "failed">, branch: string | null, note: string | null): PlaneResult {
		const task = this.state().tasks.find((t) => t.id === taskId);
		if (!task) return { ok: false, error: "No such task." };
		if (task.status !== "claimed" || task.claimedBy !== agentId) return { ok: false, error: "Only the agent that claimed the task can finish it." };
		this.sql.exec("UPDATE tasks SET status = ?, branch = ?, note = ?, updated_at = ? WHERE id = ?", status, branch, note, new Date().toISOString(), taskId);
		this.sql.exec("DELETE FROM leases WHERE task_id = ?", taskId);
		this.sql.exec(
			`DELETE FROM tasks WHERE status IN ('done', 'failed') AND id NOT IN (SELECT id FROM tasks WHERE status IN ('done', 'failed') ORDER BY updated_at DESC LIMIT ${KEEP_FINISHED})`,
		);
		this.touch(agentId);
		return this.changed();
	}

	/** Dashboards watching the board (the Worker checks access before forwarding the upgrade). */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		this.ctx.acceptWebSocket(server);
		server.send(JSON.stringify({ type: "state", state: this.state() }));
		return new Response(null, { status: 101, webSocket: client });
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (message === "ping") ws.send("pong");
	}

	override async webSocketClose(ws: WebSocket): Promise<void> {
		// Answer the close; 1005/1006 (no code, dropped connection) cannot be sent back, so always 1000.
		try {
			ws.close(1000, "closed");
		} catch {
			// Already closed.
		}
	}

	/** Expired leases disappear from the board without anyone asking. */
	override async alarm(): Promise<void> {
		this.changed();
		const next = this.nextExpiry();
		if (next) await this.ctx.storage.setAlarm(next);
	}

	private changed(): PlaneResult {
		const state = this.state();
		const message = JSON.stringify({ type: "state", state });
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(message);
			} catch {
				// A closed socket; the runtime drops it.
			}
		}
		return { ok: true, value: state };
	}

	private leases(): PlaneLease[] {
		return this.sql
			.exec<{ agent_id: string; task_id: string | null; path: string; expires_at: number }>("SELECT * FROM leases WHERE expires_at > ? ORDER BY path", Date.now())
			.toArray()
			.map((r) => ({ agentId: r.agent_id, taskId: r.task_id, path: r.path, expiresAt: r.expires_at }));
	}

	private nextExpiry(): number | null {
		const [row] = this.sql.exec<{ next: number | null }>("SELECT MIN(expires_at) AS next FROM leases").toArray();
		return row?.next ?? null;
	}

	private agent(id: string): boolean {
		return this.sql.exec("SELECT 1 FROM agents WHERE id = ?", id).toArray().length > 0;
	}

	private touch(agentId: string): void {
		this.sql.exec("UPDATE agents SET last_seen = ? WHERE id = ?", new Date().toISOString(), agentId);
	}
}

function toTask(r: Record<string, string | null>): PlaneTask {
	return {
		id: r.id!,
		title: r.title!,
		description: r.description!,
		capabilities: JSON.parse(r.capabilities!) as string[],
		status: r.status as TaskStatus,
		claimedBy: r.claimed_by ?? null,
		branch: r.branch ?? null,
		note: r.note ?? null,
		createdAt: r.created_at!,
		updatedAt: r.updated_at!,
	};
}
