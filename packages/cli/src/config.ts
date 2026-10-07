import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** ~/.appmarket (C12); APPMARKET_HOME overrides it (tests, multiple accounts). */
export const HOME = process.env.APPMARKET_HOME ?? join(homedir(), ".appmarket");
export const QUEUE_DIR = join(HOME, "queue");
export const SESSIONS_DIR = join(HOME, "sessions");
export const LOG_FILE = join(HOME, "cli.log");
export const CLIENT_ID = "appmarket-cli";
export const VERSION = "0.9.1";

/** appmarket.org unless APPMARKET_API or --api says otherwise (staging, local dev). */
export function apiBase(flag?: string): string {
	return (flag ?? process.env.APPMARKET_API ?? "https://appmarket.org").replace(/\/+$/, "");
}

export function ensureDirs(): void {
	for (const dir of [HOME, QUEUE_DIR, SESSIONS_DIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });
}
