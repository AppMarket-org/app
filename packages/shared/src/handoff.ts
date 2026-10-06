import type { CheckpointRecord } from "./checkpoints";

/**
 * #71 (G6): what earlier agent sessions in a repo did, assembled from their checkpoints, so the
 * next session (any vendor) starts with the history. Pure; the API assembles, the CLI renders.
 */
export interface SessionSummary {
	sessionId: string;
	harness: string;
	model: string;
	branch: string;
	startedAt: string;
	endedAt: string;
	/** The session's first request, and its latest if different. */
	firstPrompt: string;
	lastPrompt: string | null;
	/** What the agent said it did at its latest commit. */
	summary: string;
	/** Newest first. */
	commits: string[];
	files: string[];
	failedTools: number;
}

const clip = (text: string, max: number) => {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

type Recordish = Pick<CheckpointRecord, "commit" | "session_id" | "harness" | "model" | "branch" | "prompts" | "assistant_summary" | "files" | "tools" | "created_at">;

/** Groups checkpoint records (any order) into sessions, most recent first. */
export function summarizeSessions(records: Recordish[], limit = 3): SessionSummary[] {
	const bySession = new Map<string, Recordish[]>();
	for (const r of records) {
		const key = r.session_id || `commit:${r.commit}`;
		bySession.set(key, [...(bySession.get(key) ?? []), r]);
	}
	const sessions = [...bySession.entries()].map(([sessionId, items]) => {
		const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
		const first = sorted[0]!;
		const last = sorted.at(-1)!;
		const prompts = sorted.flatMap((r) => r.prompts.map((p) => p.text)).filter((t) => t.trim());
		const files = [...new Set(sorted.flatMap((r) => r.files.map((f) => f.path)))];
		return {
			sessionId,
			harness: last.harness,
			model: last.model,
			branch: last.branch,
			startedAt: first.created_at,
			endedAt: last.created_at,
			firstPrompt: clip(prompts[0] ?? "", 400),
			lastPrompt: prompts.length > 1 && prompts.at(-1) !== prompts[0] ? clip(prompts.at(-1)!, 300) : null,
			summary: clip(last.assistant_summary ?? "", 500),
			commits: sorted.map((r) => r.commit).reverse(),
			files: files.slice(0, 12),
			failedTools: sorted.reduce((n, r) => n + r.tools.filter((t) => t.outcome === "error").length, 0),
		};
	});
	return sessions.sort((a, b) => b.endedAt.localeCompare(a.endedAt)).slice(0, limit);
}

const HARNESS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode" };

/** The handoff as text for an agent's context, within `budget` characters (the most recent sessions first). */
export function handoffText(sessions: SessionSummary[], budget = 2500): string {
	if (!sessions.length) return "";
	const head = "# Recent agent sessions in this repo\nWhat earlier sessions (any agent) worked on, newest first. More: the session_history tool.\n";
	const parts: string[] = [];
	let used = head.length;
	for (const s of sessions) {
		const lines = [
			`## ${HARNESS[s.harness] ?? s.harness}${s.model ? ` (${s.model})` : ""} on ${s.branch || "?"}, ${s.endedAt.slice(0, 16).replace("T", " ")} UTC`,
			`- Asked: ${s.firstPrompt || "(no prompt recorded)"}`,
			...(s.lastPrompt ? [`- Last asked: ${s.lastPrompt}`] : []),
			...(s.summary ? [`- Result: ${s.summary}`] : []),
			`- Commits: ${s.commits.map((c) => c.slice(0, 7)).join(", ")}${s.files.length ? `; files: ${s.files.slice(0, 6).join(", ")}${s.files.length > 6 ? ", …" : ""}` : ""}`,
			...(s.failedTools ? [`- ${s.failedTools} failed tool call${s.failedTools === 1 ? "" : "s"}`] : []),
		];
		const block = lines.join("\n");
		if (used + block.length + 1 > budget) break;
		parts.push(block);
		used += block.length + 1;
	}
	return parts.length ? `${head}${parts.join("\n")}\n` : "";
}
