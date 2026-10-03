import { append, bufferKey, type BufferEvent } from "../buffer.ts";
import { call } from "../api.ts";
import { apiBase } from "../config.ts";
import { loadCredentials } from "../credentials.ts";
import { gitOr, repoRoot } from "../git.ts";
import { log } from "../log.ts";

const TYPES = new Set<BufferEvent["type"]>(["session.start", "settings", "prompt", "assistant", "tool", "usage", "session.end"]);

/**
 * C6 (#109): append events to this repo's buffer. Adapters pipe JSON events (one per line) on stdin;
 * people use flags. Never fails a harness: errors go to ~/.appmarket/cli.log and exit 0.
 */
export async function record(flags: Record<string, string | boolean | undefined>, stdin: string): Promise<number> {
	try {
		const cwd = typeof flags.cwd === "string" ? flags.cwd : process.cwd();
		const root = repoRoot(cwd);
		if (!root) return 0;
		if (gitOr(["config", "--get", "appmarket.disabled"], "", { cwd: root }) === "true") return 0;

		// A prompt for a commit that already has a checkpoint (`--for <sha>`): sent straight to the API.
		if (typeof flags.for === "string" && typeof flags.prompt === "string") {
			const api = gitOr(["config", "--get", "appmarket.api"], apiBase(), { cwd: root });
			const repo = gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root });
			const creds = await loadCredentials(api);
			if (!repo || !creds) throw new Error("Run `appmarket login` and `appmarket init` first.");
			const sha = gitOr(["rev-parse", flags.for], flags.for, { cwd: root });
			await call(api, `/api/repos/${repo}/checkpoints/${sha}`, { method: "PATCH", token: creds.token, body: { add_prompt: flags.prompt } });
			console.log(`Added the prompt to ${sha.slice(0, 7)}.`);
			return 0;
		}

		const key = bufferKey(root);
		const now = new Date().toISOString();
		const events: BufferEvent[] = stdin
			.split("\n")
			.filter((l) => l.trim())
			.flatMap((line) => {
				try {
					const e = JSON.parse(line) as Partial<BufferEvent>;
					return e.type && TYPES.has(e.type) ? [{ ...e, v: 1, ts: e.ts ?? now, harness: e.harness ?? "mcp" } as BufferEvent] : [];
				} catch {
					return [];
				}
			});
		const harness = typeof flags.harness === "string" ? flags.harness : "mcp";
		const session = typeof flags.session === "string" ? flags.session : undefined;
		if (typeof flags.prompt === "string") events.push({ v: 1, ts: now, type: "prompt", harness, session_id: session, text: flags.prompt });
		if (typeof flags.tool === "string") events.push({ v: 1, ts: now, type: "tool", harness, session_id: session, name: flags.tool, args: typeof flags.args === "string" ? flags.args : undefined, outcome: flags.outcome === "error" ? "error" : "ok" });
		for (const event of events) append(key, event);
		return 0;
	} catch (error) {
		if (typeof flags.for === "string") {
			console.error(error instanceof Error ? error.message : String(error));
			return 1;
		}
		log("record failed", error);
		return 0;
	}
}
