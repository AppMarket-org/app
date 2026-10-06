import type { IssueWork } from "@appmarket/shared";
import { env } from "cloudflare:workers";
import { logEvent } from "../observability/log.ts";
import type { RepoPlane } from "../plane/coordinator.ts";
import type { PlaneTask } from "../plane/model.ts";

/**
 * #296: issues and the Agents board are one list. An open issue assigned to Agents is a task on
 * the repo's board (the task's id is the issue's id); the board's progress shows on the issue, and
 * merged work closes it.
 */
const plane = (repoId: string) => env.PLANE.get(env.PLANE.idFromName(repoId)) as unknown as DurableObjectStub<RepoPlane>;

interface SyncRow {
	id: string;
	repo_id: string;
	number: number;
	title: string;
	body: string;
	type: string;
	priority: string;
	for_agents: number;
	state: string;
}

/** Puts the issue on the board, updates its task, or takes an unclaimed task off. */
export async function syncIssueTask(row: SyncRow): Promise<void> {
	await plane(row.repo_id)
		.syncIssue({ id: row.id, title: row.title, description: row.body, number: row.number, type: row.type, priority: row.priority, wanted: row.state === "open" && row.for_agents === 1 })
		.catch((error: unknown) => logEvent("issue.board_sync_failed", { issue: row.id, error: String(error) }, "warn"));
}

/** How the board's tasks for these issues stand (one board read for a whole list). */
export async function boardWork(repoId: string, issueIds: string[]): Promise<Map<string, IssueWork>> {
	const out = new Map<string, IssueWork>();
	if (!issueIds.length) return out;
	const state = await plane(repoId).state().catch(() => null);
	if (!state) return out;
	const wanted = new Set(issueIds);
	for (const task of state.tasks as PlaneTask[]) {
		if (!wanted.has(task.id)) continue;
		const agent = task.claimedBy ? (state.agents.find((a) => a.id === task.claimedBy)?.name ?? null) : null;
		const review = task.merge?.status === "review";
		out.set(task.id, { status: review ? "review" : task.status, agent, pull: task.merge?.pull ?? null });
	}
	return out;
}

/** Closes open issues as completed (merged work), by id or by number in a repo. */
export async function closeIssues(repoId: string, which: { ids?: string[]; numbers?: number[] }): Promise<number> {
	const ids = which.ids ?? [];
	const numbers = (which.numbers ?? []).slice(0, 20);
	if (!ids.length && !numbers.length) return 0;
	const where = [ids.length ? `id IN (${ids.map(() => "?").join(",")})` : null, numbers.length ? `number IN (${numbers.map(() => "?").join(",")})` : null].filter(Boolean).join(" OR ");
	const result = await env.DB.prepare(
		`UPDATE issues SET state = 'closed', reason = 'completed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		 WHERE repo_id = ? AND state = 'open' AND (${where})`,
	)
		.bind(repoId, ...ids, ...numbers)
		.run();
	return result.meta.changes ?? 0;
}
