import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirs, HOME } from "./config.ts";

/** Small local state (~/.appmarket/state.json): no telemetry, nothing leaves the machine. */
export interface State {
	lastUploadAt?: string;
	updateCheckedAt?: string;
	latestVersion?: string;
}

const FILE = join(HOME, "state.json");

export function readState(): State {
	try {
		return JSON.parse(readFileSync(FILE, "utf8")) as State;
	} catch {
		return {};
	}
}

export function writeState(patch: State): void {
	try {
		ensureDirs();
		writeFileSync(FILE, JSON.stringify({ ...readState(), ...patch }, null, 2), { mode: 0o600 });
	} catch {
		// Best effort.
	}
}
