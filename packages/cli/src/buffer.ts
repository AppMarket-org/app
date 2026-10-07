import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureDirs, SESSIONS_DIR } from "./config.ts";
import { gitOr } from "./git.ts";

/** Adapter contract: one JSON event per line, written only through `appmarket record`. */
export interface BufferEvent {
	v: 1;
	ts: string;
	type: "session.start" | "settings" | "prompt" | "assistant" | "tool" | "usage" | "session.end";
	harness: string;
	harness_version?: string;
	session_id?: string;
	model?: string;
	effort?: string;
	text?: string;
	name?: string;
	args?: string;
	outcome?: "ok" | "error";
	input_tokens?: number;
	output_tokens?: number;
	reasoning_tokens?: number;
	cost_usd?: number;
	/** Of input_tokens: read from / written to the provider's prompt cache. */
	cache_read_tokens?: number;
	cache_write_tokens?: number;
	/** Claude Code: the session transcript, and its size when this event was written (where to start reading). */
	transcript_path?: string;
	transcript_offset?: number;
}

const ROTATE_BYTES = 50 * 1024 * 1024;

/**
 * The buffer for a checkout: keyed by the appmarket repo (owner/slug) once initialised, else by its
 * path, and by the checkout itself, so two agents in two clones of one repo on the same machine
 * (agent sessions) never mix their events.
 */
export function bufferKey(root: string): string {
	const repo = gitOr(["config", "--get", "appmarket.repo"], "", { cwd: root });
	const where = createHash("sha256").update(root).digest("hex");
	return repo ? `${repo.replace(/[^A-Za-z0-9_-]+/g, "__")}__${where.slice(0, 8)}` : `path-${where.slice(0, 16)}`;
}

const paths = (key: string) => ({ buffer: join(SESSIONS_DIR, `${key}.jsonl`), marker: join(SESSIONS_DIR, `${key}.offset`) });

export function append(key: string, event: BufferEvent): void {
	ensureDirs();
	const { buffer, marker } = paths(key);
	// C12: rotate at 50 MB; anything before the marker was already checkpointed.
	if (existsSync(buffer) && statSync(buffer).size > ROTATE_BYTES) {
		const pending = readSinceMarker(key);
		renameSync(buffer, `${buffer}.1`);
		writeFileSync(buffer, pending.map((e) => JSON.stringify(e) + "\n").join(""), { mode: 0o600 });
		writeFileSync(marker, "0");
	}
	appendFileSync(buffer, JSON.stringify(event) + "\n", { mode: 0o600 });
}

function offsetOf(key: string): number {
	try {
		return Number(readFileSync(paths(key).marker, "utf8")) || 0;
	} catch {
		return 0;
	}
}

/** Events since the last checkpoint marker. */
export function readSinceMarker(key: string): BufferEvent[] {
	const { buffer } = paths(key);
	if (!existsSync(buffer)) return [];
	const all = readFileSync(buffer);
	return all
		.subarray(Math.min(offsetOf(key), all.length))
		.toString("utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as BufferEvent];
			} catch {
				return [];
			}
		});
}

/** Moves the marker to the end of the buffer (after a checkpoint). */
export function advanceMarker(key: string): void {
	const { buffer, marker } = paths(key);
	writeFileSync(marker, String(existsSync(buffer) ? statSync(buffer).size : 0));
}
